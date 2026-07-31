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

// NOTE: the raw NDJSON event stream of a run is intentionally NOT part of
// the entry — the timestamped .log file written next to the json (see
// appendGenerationLog / generationLogPath) already carries the full
// chronological trail of status changes and per-event summaries, without
// bloating the json with megabytes of transient event data.
export type GenerationEntry = {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdDate: string;
    completedDate: string | null;
    generatedTime: string | null;
    error: string | null;
    /**
     * The ORIGINAL workflow json snapshot (v0.4/v1 editor format — the
     * lossless document: positions, links, widget names, groups). It is
     * converted to the flat API prompt server-side when submitted to a
     * Comfy Cloud pod (POST /v1/comfy/cloud/prompt), so it also doubles
     * as the verbatim copy source for "create a workflow from this
     * generation".
     */
    prompt: Record<string, unknown>;
    result: GenerationResultItem[];
};

/**
 * Lightweight summary of a generation entry — what the list endpoint
 * (GET /v1/comfy/workflows/{id}/generate) returns.
 *
 * Excludes the heavy `prompt` (full workflow JSON) and `result` payloads
 * (image/video data: URLs, often megabytes of base64 each) so the list
 * stays small and loads fast. The full entry is available via
 * GET /v1/comfy/workflows/{id}/generate/{generate_id}.
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
    Pick<GenerationEntry, 'status' | 'result' | 'generatedTime' | 'completedDate' | 'error'>
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
            result: Array.isArray(data.result) ? data.result : []
            // A legacy `stream` field on disk is intentionally NOT carried
            // over — runs traced in it predate the .log file trail; leaving
            // it out here means the next write of this file drops it.
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
 * Delete a generation's files — the json record and, best-effort, the
 * sibling .log trail. Returns false when the json doesn't exist (the
 * caller's 404 case).
 *
 * Deleting a still-processing generation is safe on the json side:
 * patchGenerationFile no-ops once the file is gone, so the cloud prompt
 * endpoint's background consumer can't resurrect the record. A consumer
 * mid-run may still append a fresh orphan .log afterwards — harmless, and
 * unavoidable without an execution-cancel mechanism.
 */
export function deleteGenerationFiles(root: string, workflowId: string, generateId: string): boolean {
    const jsonPath = generationFilePath(root, workflowId, generateId);
    if (!fs.existsSync(jsonPath)) return false;
    fs.rmSync(jsonPath, { force: true });
    try {
        fs.rmSync(generationLogPath(root, workflowId, generateId), { force: true });
    } catch {
        // Best-effort — a broken log removal never fails the delete.
    }
    return true;
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

    writeGenerationFile(root, workflowId, generateId, existing);
    return existing;
}
