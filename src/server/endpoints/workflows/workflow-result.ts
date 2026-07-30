// Generation result streaming endpoint
//
// GET /v1/comfy/workflows/:id/generate/:generate_id/result/:index
//
// Streams a single generation result (image or video) back as raw binary
// with its real Content-Type, so the URL can be dropped straight into
// <img src=...> / <video src=...> — no base64 JSON payloads, no client-side
// blob conversion.
//
// Result payloads come in two shapes (see GenerationResultItem.url):
//   - `data:` URLs (base64, captured from the pod's event stream) — decoded
//     here and streamed with the stored mimeType.
//   - Remote http(s) URLs — answered with a 302 redirect so the upstream
//     server hands the bytes over directly.
//
// Byte-range requests are honored for data: payloads (single ranges only) —
// required by some browsers (notably Safari) before they will play <video>
// at all, and what makes seeking/scrubbing work.

import { asHandlerMethod } from '@underload/service';
import { readGenerationFile } from './generation-store';

/** Generation results are immutable snapshots — let the browser cache them. */
const RESULT_CACHE_CONTROL = 'private, max-age=3600';

/** Best-known file extension per mime type, for the inline filename hint. */
const MIME_EXTENSIONS: Record<string, string> = {
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
 * Decode a `data:` URL payload to bytes. Returns null for non-data URLs,
 * non-base64 payloads, or undecodable input.
 */
function decodeDataUrl(url: string): { mime: string; bytes: Buffer } | null {
    if (!url.startsWith('data:')) return null;
    const commaIdx = url.indexOf(',');
    if (commaIdx === -1) return null;
    const meta = url.substring(0, commaIdx);
    const payload = url.substring(commaIdx + 1);
    if (!/;base64/i.test(meta)) return null; // only base64 payloads are stored
    const mime = /^data:([^;,]*)/.exec(meta)?.[1] ?? 'application/octet-stream';
    try {
        return { mime, bytes: Buffer.from(payload, 'base64') };
    } catch {
        return null;
    }
}

/**
 * Parse a `Range: bytes=start-end` header against the payload size.
 * Returns the [start, end] to serve (clamped, "suffix"-ranges resolved),
 * 'unsatisfiable' when the range cannot be honored, or null when no Range
 * header was sent / it is malformed (serve the full body instead).
 */
function parseRangeHeader(
    header: string | undefined,
    size: number
): { start: number; end: number } | 'unsatisfiable' | null {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null; // malformed (e.g. multi-range) → full body

    let start: number;
    let end: number;
    if (match[1] === '') {
        // Suffix range: "bytes=-N" → last N bytes
        const suffix = Number(match[2]);
        if (!Number.isFinite(suffix) || suffix <= 0) return 'unsatisfiable';
        start = Math.max(0, size - suffix);
        end = size - 1;
    } else {
        start = Number(match[1]);
        end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    }

    if (start >= size || start > end) return 'unsatisfiable';
    return { start, end };
}

/** GET — Stream one result item (image/video) of a generation as raw binary. */
export const workflowGenerateResultGet = asHandlerMethod(async (context, parameters, variables) => {
    const projectRoot: string = variables.root;
    const workflowId = parameters.path.id;
    const generateId = parameters.path.generate_id;
    const indexParam = parameters.path.index;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }
    if (!generateId) {
        return { status: 400, response: { error: 'generate_id is required' } };
    }
    const index = Number(indexParam);
    if (indexParam === undefined || indexParam === null || !Number.isInteger(index) || index < 0) {
        return { status: 400, response: { error: 'index must be a non-negative integer' } };
    }

    const entry = readGenerationFile(projectRoot, workflowId, generateId);
    if (!entry) {
        return { status: 404, response: { error: `Generation '${generateId}' not found` } };
    }

    const item = entry.result[index];
    if (!item) {
        return {
            status: 404,
            response: {
                error: `Result index ${index} not found — generation '${generateId}' has ${entry.result.length} result(s)`
            }
        };
    }

    // Remote URL → let the upstream server deliver the bytes via redirect.
    // Works transparently inside <img src> / <video src>.
    if (/^https?:\/\//i.test(item.url)) {
        return {
            status: 302,
            raw: Response.redirect(item.url, 302)
        };
    }

    // Stored payload is a base64 data: URL — decode and serve.
    const decoded = decodeDataUrl(item.url);
    if (!decoded) {
        return {
            status: 422,
            response: { error: 'Result payload is not servable (unsupported url format)' }
        };
    }

    const mime = item.mimeType || decoded.mime;
    const ext = MIME_EXTENSIONS[mime] ?? '';
    const baseHeaders: Record<string, string> = {
        'Content-Type': mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': RESULT_CACHE_CONTROL,
        'Content-Disposition': `inline; filename="${generateId}-${index}${ext}"`,
        'Access-Control-Allow-Origin': '*'
    };

    // Honor byte-range requests — required by some browsers (Safari) for
    // <video> playback, and what enables seeking on large payloads.
    const range = parseRangeHeader(context.req.header('range') ?? context.req.header('Range'), decoded.bytes.length);
    if (range === 'unsatisfiable') {
        return {
            status: 416,
            raw: new Response(null, {
                status: 416,
                headers: { ...baseHeaders, 'Content-Range': `bytes */${decoded.bytes.length}` }
            })
        };
    }

    if (range) {
        const slice = decoded.bytes.subarray(range.start, range.end + 1);
        return {
            status: 206,
            raw: new Response(new Uint8Array(slice), {
                status: 206,
                headers: {
                    ...baseHeaders,
                    'Content-Length': String(slice.length),
                    'Content-Range': `bytes ${range.start}-${range.end}/${decoded.bytes.length}`
                }
            })
        };
    }

    return {
        status: 200,
        raw: new Response(new Uint8Array(decoded.bytes), {
            status: 200,
            headers: {
                ...baseHeaders,
                'Content-Length': String(decoded.bytes.length)
            }
        })
    };
});
