// =============================================================================
// Generation result endpoint — streaming (byte-range) behavior tests
//
// GET /v1/comfy/workflows/:id/generate/:generate_id/result/:index
// (workflowGenerateResultGet in workflow-result.ts) is the URL the UI points
// <img src>/<video src> at. For a <video> to play WITHOUT downloading the
// whole payload first, the endpoint must:
//
//   1. Advertise `Accept-Ranges: bytes` on every media response.
//   2. Answer `Range: bytes=start-end` with 206 + Content-Range + the exact
//      byte slice (also covering open-ended and suffix ranges — what
//      browsers actually send).
//   3. Answer out-of-bounds ranges with 416, not a silent full body.
//   4. Redirect (302) when the stored result is a remote http(s) URL, so the
//      upstream delivers the bytes.
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

/** Seed a generation file holding a single base64-backed video result. */
function seedGeneration(url: string, mimeType = 'video/mp4') {
    const dir = path.join(tmpRoot, 'temporary/database/comfy-workflows', WORKFLOW_ID, 'generation');
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

beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-result-test-'));
    seedGeneration(`data:video/mp4;base64,${payloadB64}`);
});

afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('workflowGenerateResultGet — streaming API contract', () => {
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

    it('redirects (302) when the stored result is a remote http(s) URL', async () => {
        seedGeneration('https://cdn.example.com/video/clip.mp4');
        const out = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });

        expect(out.status).toBe(302);
        expect(out.raw!.status).toBe(302);
        expect(out.raw!.headers.get('location')).toBe('https://cdn.example.com/video/clip.mp4');
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
