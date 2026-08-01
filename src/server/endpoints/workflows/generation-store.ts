// Shared generation-file store.
//
// A generation json lives at:
//   <root>/temporary/database/comfy-workflows/<workflowId>/generation/<generateId>.json
//
// Result media payloads (image/video/audio, often megabytes each) are NOT
// stored inside the json. At write time (cloud prompt endpoint, generation
// PUT) they are persisted as plain files:
//   <root>/temporary/database/comfy-workflows/<workflowId>/generation/<generateId>/<index>.<ext>
// and the json's result items reference them with a `file:` url (see
// persistResultAssets). The result endpoint answers those with a 302 to the
// static /v1/comfy/media mount, so the bytes are served off disk by the OS —
// never parsed out of JSON, never buffered by an endpoint. Legacy entries
// with inline `data:` base64 urls (and remote http(s) urls) keep working.
//
// Used by the workflow generate endpoints (CRUD) and by the cloud prompt
// endpoint, which updates the same file server-side while it consumes a
// pod's NDJSON stream in the background. Keeping the types + IO in one
// place guarantees both write paths produce identical data.

import fs from 'node:fs';
import path from 'node:path';

export type GenerationResultItem = {
    type: 'image' | 'video' | 'audio';
    url: string;
    mimeType: string;
    size: number;
    nodeId: string;
};

/**
 * URL scheme marking a result payload stored as a PLAIN FILE on disk (in
 * the generation's assets folder) instead of inline base64. The value after
 * the prefix is the file name within that folder — always `<index>.<ext>`,
 * written by persistResultAssets. Never an absolute path, never absolute
 * URL: the result endpoint turns it into a root-relative /v1/comfy/media
 * redirect, so whatever host a (LAN) client used to reach the server stays
 * the host the media comes from.
 */
export const FILE_URL_PREFIX = 'file:';

/**
 * Best-known file extension per result MIME type — the asset files get
 * real extensions so the static media mount infers the right Content-Type
 * and browsers sniff nothing.
 */
export const RESULT_MIME_EXTENSIONS: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav'
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
 * Directory holding a generation's media asset files — a sibling folder of
 * its .json/.log named after the generation:
 *
 *   <root>/temporary/database/comfy-workflows/<workflowId>/generation/<generateId>/
 *
 * Each file is named `<resultIndex>.<ext>` (see persistResultAssets), which
 * keeps the json result array's `file:` references and the on-disk names in
 * lockstep. Served over HTTP exclusively via the static /v1/comfy/media
 * mount (whitelisted to media extensions — the .json/.log siblings are
 * never served).
 */
export function generationAssetsDirPath(root: string, workflowId: string, generateId: string): string {
    return path.join(
        root,
        'temporary/database/comfy-workflows',
        workflowId,
        'generation',
        generateId
    );
}

/**
 * Decode a `data:` URL into its MIME and raw bytes. Returns null for
 * non-data urls, non-base64 payloads, or undecodable input.
 */
function decodeDataUrlPayload(url: string): { mime: string; bytes: Buffer } | null {
    if (!url.startsWith('data:')) return null;
    const commaIdx = url.indexOf(',');
    if (commaIdx === -1) return null;
    const meta = url.substring(0, commaIdx);
    const payload = url.substring(commaIdx + 1);
    if (!/;base64/i.test(meta)) return null;
    const mime = /^data:([^;,]*)/.exec(meta)?.[1] ?? 'application/octet-stream';
    try {
        return { mime, bytes: Buffer.from(payload, 'base64') };
    } catch {
        return null;
    }
}

/**
 * Move inline `data:` payloads of a result array OUT of the json and into
 * asset files on disk, returning the array with `file:` references in
 * place of the data urls.
 *
 * Per item:
 *   - `data:` url  → bytes written to `<assetsDir>/<index>.<ext>`; the item
 *     is returned with `url: "file:<index>.<ext>"`, a normalized mimeType
 *     and the exact decoded byte size.
 *   - `file:` / `http(s):` (or anything else) → returned untouched.
 *
 * Writing is all-or-nothing PER ITEM: if a file write fails (disk full,
 * permissions, …) that item keeps its original `data:` payload — the result
 * endpoint serves `data:` urls as a legacy path, so nothing is ever lost,
 * the run just doesn't get the file-system speedup for that item.
 *
 * The json with `file:` references stays small (KBs), which is the whole
 * point: reads (list, refresh, result lookups) stop parsing megabytes of
 * base64, and media bytes flow off disk untouched by JSON.stringify.
 */
export function persistResultAssets(
    root: string,
    workflowId: string,
    generateId: string,
    results: GenerationResultItem[]
): GenerationResultItem[] {
    const assetsDir = generationAssetsDirPath(root, workflowId, generateId);
    let dirReady = false;

    return results.map((item, index) => {
        if (!item.url.startsWith('data:')) return item;
        const decoded = decodeDataUrlPayload(item.url);
        if (!decoded) return item; // malformed payload — keep as-is

        const mime = item.mimeType || decoded.mime;
        const ext = RESULT_MIME_EXTENSIONS[mime] ?? '';
        const fileName = `${index}${ext}`;
        try {
            if (!dirReady) {
                fs.mkdirSync(assetsDir, { recursive: true });
                dirReady = true;
            }
            fs.writeFileSync(path.join(assetsDir, fileName), decoded.bytes);
            return {
                ...item,
                url: `${FILE_URL_PREFIX}${fileName}`,
                mimeType: mime,
                size: decoded.bytes.length
            };
        } catch {
            // Best-effort — on write failure keep the inline payload so the
            // result stays servable through the legacy data: path.
            return item;
        }
    });
}

/**
 * One-time heal for generations stored before file-backed results: if the
 * entry still carries inline `data:` result payloads, move them to asset
 * files and rewrite the json with `file:` references. Returns the entry to
 * serve from — migrated whenever possible, the ORIGINAL when the json
 * rewrite fails (the read endpoints then hit their fallback path instead;
 * the next read retries the migration). No-op when nothing inline remains.
 *
 * After one pass the generation json holds only small references — reads
 * stop parsing megabytes of base64 and the media serves straight off disk.
 */
export function migrateGenerationAssets(
    root: string,
    workflowId: string,
    generateId: string,
    entry: GenerationEntry
): GenerationEntry {
    if (!entry.result.some((r) => r.url.startsWith('data:'))) return entry;

    const migrated: GenerationEntry = {
        ...entry,
        result: persistResultAssets(root, workflowId, generateId, entry.result)
    };
    try {
        writeGenerationFile(root, workflowId, generateId, migrated);
    } catch {
        // Best-effort — a failed rewrite never loses data: the asset files
        // already exist and the original json stays authoritative until the
        // next read retries.
    }
    return migrated;
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
 * sibling .log trail and the media assets folder. Returns false when the
 * json doesn't exist (the caller's 404 case).
 *
 * Deleting a still-processing generation is safe on the json side:
 * patchGenerationFile no-ops once the file is gone, so the cloud prompt
 * endpoint's background consumer can't resurrect the record. A consumer
 * mid-run may still append a fresh orphan .log (or asset file) afterwards —
 * harmless, and unavoidable without an execution-cancel mechanism.
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
    try {
        fs.rmSync(generationAssetsDirPath(root, workflowId, generateId), {
            recursive: true,
            force: true
        });
    } catch {
        // Best-effort — media cleanup never fails the delete.
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
