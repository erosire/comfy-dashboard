// Generation result streaming endpoint
//
// GET /v1/comfy/workflows/:id/generate/:generate_id/result/:index
//
// Answers a single generation result (image/video/audio) so the URL can be
// dropped straight into <img src=...> / <video src=...> / <audio src=...> —
// no base64 JSON payloads, no client-side blob conversion.
//
// Result payloads come in three shapes (see GenerationResultItem.url):
//   - `file:` references (the ONLY shape stored going forward — the payload
//     lives as a plain file in the generation's assets folder): answered
//     with a 302 redirect to the static /v1/comfy/media mount, which streams
//     the file off disk (with byte-range support) — this endpoint never
//     touches the bytes. The Location is ROOT-RELATIVE, so it resolves
//     against whatever origin the client reached this server by (localhost,
//     LAN IP, hostname) — the same json serves every interface correctly.
//   - `data:` URLs (base64, from generations written before file-backed
//     storage): MIGRATED ON FIRST READ — decoded once, written to asset
//     files, the json rewritten with `file:` references — then served via
//     redirect like any other file-backed result. The decode-and-stream
//     path below only remains as the write-failure fallback (media stays
//     viewable even if the asset write couldn't happen).
//   - Remote http(s) URLs — answered with a 302 redirect so the upstream
//     server hands the bytes over directly.
//
// Byte-range requests are honored for the data: fallback path (single
// ranges only). For file: payloads the static mount handles ranges itself,
// after the redirect — that includes what browsers (notably Safari) need
// for <video> playback and seeking.

import { asHandlerMethod } from '@underload/service';
import {
    FILE_URL_PREFIX,
    COMFY_WORKFLOWS_DIRECTORY,
    RESULT_MIME_EXTENSIONS,
    migrateGenerationAssets,
    readGenerationFile
} from './generation-store';

/** Generation results are immutable snapshots — let the browser cache them. */
const RESULT_CACHE_CONTROL = 'private, max-age=3600';

/**
 * Route prefix of the static media mount (see the staticRoutes registration
 * in @underload/service's server.ts). Files are addressed as
 * `<MEDIA_ROUTE_PREFIX>/<workflowId>/generation/<generateId>/<index>.<ext>`.
 * The distribution directory is part of this child URL below the shared
 * /v1/comfy/media mount, matching the service's database-root static mount.
 */
const MEDIA_ROUTE_PREFIX = `/v1/comfy/media/${COMFY_WORKFLOWS_DIRECTORY}`;

/**
 * The only file names this server ever writes into an assets folder
 * (persistResultAssets): a result-array index plus an optional lowercase
 * extension. Anything else in a `file:` reference means a hand-edited or
 * foreign generation json — refused outright rather than letting a crafted
 * reference try to escape the assets directory.
 */
const ASSET_FILE_NAME = /^\d+(\.[a-z0-9]+)?$/i;

/** Best-known file extension per mime type, for the inline filename hint. */
const MIME_EXTENSIONS: Record<string, string> = RESULT_MIME_EXTENSIONS;

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

/** GET — Serve one result item (image/video/audio) of a generation. */
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

    const loaded = await readGenerationFile(projectRoot, workflowId, generateId);
    if (!loaded) {
        return { status: 404, response: { error: `Generation '${generateId}' not found` } };
    }

    // One-time storage heal: generations written before file-backed results
    // still hold inline base64 — move it to asset files and rewrite the
    // json. After this the normal path below is always the redirect; the
    // decode-and-stream branch only survives for items whose asset write
    // failed this very request.
    const entry = await migrateGenerationAssets(projectRoot, workflowId, generateId, loaded);

    const item = entry.result[index];
    if (!item) {
        return {
            status: 404,
            response: {
                error: `Result index ${index} not found — generation '${generateId}' has ${entry.result.length} result(s)`
            }
        };
    }

    // File-backed payload (current storage) → let the static media mount
    // serve the bytes off disk via a redirect. The Location is root-relative
    // BY DESIGN: it resolves against whatever origin the client used (LAN
    // IP included), so no host is ever baked into the stored json. Note the
    // redirect target is built with new Response(...) — Response.redirect()
    // rejects relative URLs in Node.
    if (item.url.startsWith(FILE_URL_PREFIX)) {
        const fileName = item.url.slice(FILE_URL_PREFIX.length);
        if (!ASSET_FILE_NAME.test(fileName)) {
            return {
                status: 422,
                response: { error: 'Result file reference is malformed' }
            };
        }
        const location =
            `${MEDIA_ROUTE_PREFIX}/${encodeURIComponent(workflowId)}` +
            `/generation/${encodeURIComponent(generateId)}/${encodeURIComponent(fileName)}`;
        return {
            status: 302,
            raw: new Response(null, {
                status: 302,
                headers: {
                    'Location': location,
                    'Cache-Control': RESULT_CACHE_CONTROL,
                    'Access-Control-Allow-Origin': '*'
                }
            })
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

    // FALLBACK: an inline base64 payload that could NOT be migrated to an
    // asset file on this request (disk/permission failure — the json keeps
    // the data: url and the migration retries on the next read). Decode and
    // stream so the result stays viewable instead of erroring out.
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
