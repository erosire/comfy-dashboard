// Shared generation-file store.
//
// A generation json lives at:
//   <root>/temporary/database/comfy-workflows/<workflowId>/generation/<generateId>.json
//
// Used by the workflow generate endpoints (CRUD) and by the cloud prompt
// endpoint, which updates the same file server-side while it consumes a
// pod's NDJSON stream in the background. Keeping the types + IO in one
// place guarantees both write paths produce identical data.

import fs from 'node:fs';
import path from 'node:path';

export type GenerationResultItem = {
    type: 'image' | 'video';
    url: string;
    mimeType: string;
    size: number;
    nodeId: string;
};

/**
 * A result item WITHOUT its heavy `url` payload — what summary responses
 * carry so a caller can label/count results (and choose <img> vs <video>)
 * without pulling megabytes of base64. The bytes themselves are streamed
 * on demand via GET .../generate/{generate_id}/result/{index}.
 */
export type GenerationResultMeta = Omit<GenerationResultItem, 'url'>;

export type StreamEvent = {
    type: string;
    data: Record<string, unknown>;
};

export type GenerationEntry = {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdDate: string;
    completedDate: string | null;
    generatedTime: string | null;
    error: string | null;
    prompt: Record<string, unknown>;
    result: GenerationResultItem[];
    stream: StreamEvent[];
};

/**
 * Lightweight summary of a generation entry — what the list endpoint
 * (GET /v1/comfy/workflows/{id}/generate) returns.
 *
 * Excludes the heavy `prompt` (full workflow JSON), `result` (image/video
 * data: URLs, often megabytes of base64 each), and `stream` (raw NDJSON
 * events) so the list stays small and loads fast. The full entry is
 * available via GET /v1/comfy/workflows/{id}/generate/{generate_id}.
 *
 * `resultCount` lets callers render "N items" and decide whether to open
 * the results, while `resultItems` provides the per-result display metadata
 * (type/mime/size/node — but NOT the `url` payloads). The actual bytes are
 * streamed from GET .../generate/{generate_id}/result/{index}, which can be
 * used directly as <img src> / <video src>.
 */
export type GenerationSummary = {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdDate: string;
    completedDate: string | null;
    generatedTime: string | null;
    error: string | null;
    /** Number of result items (images/videos) in the full entry. */
    resultCount: number;
    /** Per-result display metadata — everything except the heavy url payload. */
    resultItems: GenerationResultMeta[];
};

export type GenerationPatch = Partial<
    Pick<GenerationEntry, 'status' | 'result' | 'stream' | 'generatedTime' | 'completedDate' | 'error'>
>;

/** Project a full GenerationEntry down to its lightweight summary. */
export function toGenerationSummary(entry: GenerationEntry): GenerationSummary {
    return {
        id: entry.id,
        status: entry.status,
        createdDate: entry.createdDate,
        completedDate: entry.completedDate,
        generatedTime: entry.generatedTime,
        error: entry.error,
        resultCount: entry.result.length,
        // Drop the heavy `url` (data: base64 / remote link) — everything else
        // is small display metadata the UI needs without the payload.
        resultItems: entry.result.map(({ url: _url, ...meta }) => meta)
    };
}

export function generationFilePath(root: string, workflowId: string, generateId: string): string {
    return path.join(
        root,
        'temporary/database/comfy-workflows',
        workflowId,
        'generation',
        `${generateId}.json`
    );
}

/**
 * Path of the human-readable log file kept next to a generation json.
 *
 *   <root>/temporary/database/comfy-workflows/<workflowId>/generation/<generateId>.log
 *
 * The cloud prompt endpoint appends a timestamped line per status change
 * and per streamed event while it processes a generation server-side, so
 * the run can be reviewed after (or during) completion without replaying
 * the raw NDJSON stream.
 */
export function generationLogPath(root: string, workflowId: string, generateId: string): string {
    return path.join(
        root,
        'temporary/database/comfy-workflows',
        workflowId,
        'generation',
        `${generateId}.log`
    );
}

/**
 * Append a timestamped line to the generation's .log file (next to its .json).
 *
 * Logging is best-effort: any write failure is swallowed so a broken log
 * never fails an in-flight generation. The generation directory is created
 * on demand (the .json writer usually creates it first, but we ensure it
 * exists to stay self-contained).
 */
export function appendGenerationLog(
    root: string,
    workflowId: string,
    generateId: string,
    message: string
): void {
    try {
        const logPath = generationLogPath(root, workflowId, generateId);
        fs.mkdirSync(path.dirname(logPath), { recursive: true });
        const line = `[${new Date().toISOString()}] ${message}\n`;
        fs.appendFileSync(logPath, line, 'utf-8');
    } catch {
        // Best-effort — never fail a generation over a log write.
    }
}

/** Read + normalize a generation file. Returns null if missing or corrupted. */
export function readGenerationFile(
    root: string,
    workflowId: string,
    generateId: string
): GenerationEntry | null {
    const filePath = generationFilePath(root, workflowId, generateId);
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return {
            id: data.id ?? generateId,
            status: data.status ?? 'pending',
            createdDate: data.createdDate ?? '',
            completedDate: data.completedDate ?? null,
            generatedTime: data.generatedTime ?? null,
            error: data.error ?? null,
            prompt: data.prompt ?? {},
            result: Array.isArray(data.result) ? data.result : [],
            stream: Array.isArray(data.stream) ? data.stream : []
        };
    } catch {
        return null;
    }
}

export function writeGenerationFile(
    root: string,
    workflowId: string,
    generateId: string,
    entry: GenerationEntry
): void {
    fs.writeFileSync(
        generationFilePath(root, workflowId, generateId),
        JSON.stringify(entry, null, 2),
        'utf-8'
    );
}

/**
 * Merge a partial patch into an existing generation file.
 * Only provided fields are overwritten. Returns the updated entry,
 * or null when the file is missing/unreadable.
 */
export function patchGenerationFile(
    root: string,
    workflowId: string,
    generateId: string,
    patch: GenerationPatch
): GenerationEntry | null {
    const existing = readGenerationFile(root, workflowId, generateId);
    if (!existing) return null;

    if (patch.status !== undefined) existing.status = patch.status;
    if (patch.completedDate !== undefined) existing.completedDate = patch.completedDate;
    if (patch.generatedTime !== undefined) existing.generatedTime = patch.generatedTime;
    if (patch.error !== undefined) existing.error = patch.error;
    if (patch.result !== undefined) existing.result = patch.result;
    if (patch.stream !== undefined) existing.stream = patch.stream;

    writeGenerationFile(root, workflowId, generateId, existing);
    return existing;
}
