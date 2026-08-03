// =============================================================================
// Generation result endpoint — serving behavior tests
//
// GET /v1/comfy/workflows/:id/generate/:generate_id/result/:index
// (workflowGenerateResultGet in workflow-result.ts) is the URL the UI points
// <img src>/<video src>/<audio src> at. Contract:
//
//   1. `file:`-backed results (the only shape stored going forward) are
//      answered with a 302 redirect to the static /v1/comfy/media mount
//      (root-relative Location — any client origin, localhost or LAN IP,
//      resolves it); the endpoint never touches the bytes.
//   2. Legacy `data:` base64 payloads are MIGRATED on first read: written
//      to asset files, the json rewritten with `file:` references, then the
//      request is answered with the same redirect. Nothing inline-base64
//      remains in the json afterwards.
//   3. When the asset write FAILS (disk/permission — simulated here by
//      blocking the assets folder with a same-named file), the decode
//      fallback serves the payload with full byte-range behavior:
//      `Accept-Ranges: bytes`, exact 206 slices (explicit / open-ended /
//      suffix), 416 on unsatisfiable — required by some browsers (notably
//      Safari) before they will play <video> at all.
//   4. Remote http(s) urls redirect (302) so the upstream delivers the bytes.
//   5. Malformed `file:` references (traversal / foreign names) are refused
//      with 422.
//
// (Whether an MP4 result *inside* those bytes starts playing progressively
// additionally depends on the file's moov atom being at the front — that is
// the encoder's responsibility, handled by the ComfyUI-CloudClient
// ClientVideoSaveNode / utils/mp4.py faststart muxing, not this endpoint.)
// =============================================================================

// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workflowGenerateResultGet } from './workflow-result';
import { generationAssetsDirPath, generationFilePath } from './generation-store';

// 4096 payload bytes with a position-dependent pattern, so any served slice
// can be verified byte-for-byte against the expected offset window.
const PAYLOAD_SIZE = 4096;
const payloadBytes = Buffer.alloc(PAYLOAD_SIZE);
for (let i = 0; i < PAYLOAD_SIZE; i++) payloadBytes[i] = i % 251;
const payloadB64 = payloadBytes.toString('base64');

const WORKFLOW_ID = 'wf-test';
const GENERATION_ID = 'gen-test';

let tmpRoot: string;

/** Minimal Hono-context stand-in: the handler only reads request headers. */
function makeContext(headers: Record<string, string> = {}) {
    const lowered = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    return {
        req: {
            header: (name: string) => lowered[name.toLowerCase()]
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function makeParams(index: string | number) {
    return {
        path: { id: WORKFLOW_ID, generate_id: GENERATION_ID, index },
        query: {},
        body: {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

/** Seed a generation file holding a single video result with the given url. */
function seedGeneration(url: string, mimeType = 'video/mp4') {
    const dir = path.join(tmpRoot, 'comfy-workflows', WORKFLOW_ID, 'generation');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, `${GENERATION_ID}.json`),
        JSON.stringify({
            id: GENERATION_ID,
            status: 'completed',
            createdDate: '2026-08-01T00:00:00.000Z',
            completedDate: '2026-08-01T00:00:10.000Z',
            generatedTime: '10.0s',
            error: null,
            prompt: {},
            result: [{ type: 'video', url, mimeType, size: PAYLOAD_SIZE, nodeId: '9' }]
        }),
        'utf-8'
    );
}

function readStoredJson(): { result: { url: string }[] } {
    return JSON.parse(
        fs.readFileSync(generationFilePath(tmpRoot, WORKFLOW_ID, GENERATION_ID), 'utf-8')
    );
}

const MEDIA_LOCATION = (file: string) =>
    `/v1/comfy/media/comfy-workflows/${WORKFLOW_ID}/generation/${GENERATION_ID}/${file}`;

beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-result-test-'));
    seedGeneration(`data:video/mp4;base64,${payloadB64}`);
});

afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('workflowGenerateResultGet — normal paths', () => {
    it('migrates an inline base64 payload to an asset file, then redirects to the media mount', async () => {
        const out = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });

        // Served via redirect — the endpoint never buffered the bytes.
        expect(out.status).toBe(302);
        expect(out.raw!.headers.get('location')).toBe(MEDIA_LOCATION('0.mp4'));

        // The payload now lives as a plain file with the exact bytes…
        const asset = fs.readFileSync(
            path.join(generationAssetsDirPath(tmpRoot, WORKFLOW_ID, GENERATION_ID), '0.mp4')
        );
        expect(asset.equals(payloadBytes)).toBe(true);

        // …and the json no longer holds any base64.
        expect(readStoredJson().result[0].url).toBe('file:0.mp4');

        // Second read: the `file:` branch directly — same redirect, no re-migration.
        const again = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });
        expect(again.status).toBe(302);
        expect(again.raw!.headers.get('location')).toBe(MEDIA_LOCATION('0.mp4'));
    });

    it('migrates any Range request the same way (ranges are served by the media mount after redirect)', async () => {
        const out = await workflowGenerateResultGet(
            makeContext({ Range: 'bytes=100-199' }),
            makeParams(0),
            { root: tmpRoot }
        );
        expect(out.status).toBe(302);
        expect(out.raw!.headers.get('location')).toBe(MEDIA_LOCATION('0.mp4'));
    });

    it('redirects (302) to the static media mount for a file-backed result', async () => {
        seedGeneration('file:0.mp4');
        const out = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });

        expect(out.status).toBe(302);
        expect(out.raw!.status).toBe(302);
        // Root-relative Location — the browser resolves it against whatever
        // origin it reached the server by (localhost, LAN IP, …).
        expect(out.raw!.headers.get('location')).toBe(MEDIA_LOCATION('0.mp4'));
    });

    it('redirects (302) for a file-backed result without an extension', async () => {
        seedGeneration('file:2');
        const out = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });

        expect(out.status).toBe(302);
        expect(out.raw!.headers.get('location')).toBe(MEDIA_LOCATION('2'));
    });

    it('redirects (302) when the stored result is a remote http(s) URL', async () => {
        seedGeneration('https://cdn.example.com/video/clip.mp4');
        const out = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });

        expect(out.status).toBe(302);
        expect(out.raw!.status).toBe(302);
        expect(out.raw!.headers.get('location')).toBe('https://cdn.example.com/video/clip.mp4');
    });

    it('answers 422 for a file: reference that is not an index file name (traversal/foreign names)', async () => {
        for (const bad of ['file:../../secret.png', 'file:evil.png', 'file:0/../1.png', 'file:sub/0.png']) {
            seedGeneration(bad);
            const out = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });
            expect(out.status).toBe(422);
        }
    });

    it('404s gracefully for unknown generations and out-of-range indexes', async () => {
        const missingGen = await workflowGenerateResultGet(
            makeContext(),
            { path: { id: WORKFLOW_ID, generate_id: 'nope', index: 0 }, query: {}, body: {} } as any,
            { root: tmpRoot }
        );
        expect(missingGen.status).toBe(404);

        const missingIndex = await workflowGenerateResultGet(makeContext(), makeParams(3), { root: tmpRoot });
        expect(missingIndex.status).toBe(404);
    });
});

describe('workflowGenerateResultGet — base64 decode fallback (asset write failed)', () => {
    beforeEach(() => {
        // Block the assets folder with a same-named FILE so every asset
        // write fails — the generation json keeps its inline base64 and the
        // endpoint must serve through its decode fallback.
        fs.writeFileSync(generationAssetsDirPath(tmpRoot, WORKFLOW_ID, GENERATION_ID), 'blocked');
    });

    it('serves the full payload with Accept-Ranges advertised (no Range header)', async () => {
        const out = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });

        expect(out.status).toBe(200);
        expect(out.raw).toBeInstanceOf(Response);
        expect(out.raw!.status).toBe(200);
        expect(out.raw!.headers.get('Accept-Ranges')).toBe('bytes');
        expect(out.raw!.headers.get('Content-Type')).toBe('video/mp4');
        expect(out.raw!.headers.get('Content-Length')).toBe(String(PAYLOAD_SIZE));

        const body = Buffer.from(await out.raw!.arrayBuffer());
        expect(body.equals(payloadBytes)).toBe(true);
    });

    it('answers an explicit byte range with 206 + exact slice', async () => {
        const out = await workflowGenerateResultGet(
            makeContext({ Range: 'bytes=100-199' }),
            makeParams(0),
            { root: tmpRoot }
        );

        expect(out.status).toBe(206);
        expect(out.raw!.headers.get('Content-Range')).toBe(`bytes 100-199/${PAYLOAD_SIZE}`);
        expect(out.raw!.headers.get('Content-Length')).toBe('100');

        const body = Buffer.from(await out.raw!.arrayBuffer());
        expect(body.equals(payloadBytes.subarray(100, 200))).toBe(true);
    });

    it('answers an open-ended range (bytes=start-) through the end', async () => {
        const out = await workflowGenerateResultGet(
            makeContext({ Range: 'bytes=4090-' }),
            makeParams(0),
            { root: tmpRoot }
        );

        expect(out.status).toBe(206);
        expect(out.raw!.headers.get('Content-Range')).toBe(`bytes 4090-${PAYLOAD_SIZE - 1}/${PAYLOAD_SIZE}`);

        const body = Buffer.from(await out.raw!.arrayBuffer());
        expect(body.equals(payloadBytes.subarray(4090))).toBe(true);
    });

    it('answers a suffix range (bytes=-N) with the last N bytes', async () => {
        const out = await workflowGenerateResultGet(
            makeContext({ Range: 'bytes=-10' }),
            makeParams(0),
            { root: tmpRoot }
        );

        expect(out.status).toBe(206);
        expect(out.raw!.headers.get('Content-Range')).toBe(`bytes ${PAYLOAD_SIZE - 10}-${PAYLOAD_SIZE - 1}/${PAYLOAD_SIZE}`);

        const body = Buffer.from(await out.raw!.arrayBuffer());
        expect(body.equals(payloadBytes.subarray(PAYLOAD_SIZE - 10))).toBe(true);
    });

    it('answers an unsatisfiable range with 416 (never a silent full body)', async () => {
        const out = await workflowGenerateResultGet(
            makeContext({ Range: `bytes=${PAYLOAD_SIZE}-` }),
            makeParams(0),
            { root: tmpRoot }
        );

        expect(out.status).toBe(416);
        expect(out.raw!.headers.get('Content-Range')).toBe(`bytes */${PAYLOAD_SIZE}`);
    });

    it('keeps the json inline (migration retries on the next read) and writes no asset file', async () => {
        const out = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });
        expect(out.status).toBe(200);
        expect(readStoredJson().result[0].url.startsWith('data:')).toBe(true);
    });
});
