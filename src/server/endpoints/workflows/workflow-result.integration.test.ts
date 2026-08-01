// =============================================================================
// Generation result — END-TO-END HTTP integration
//
// Boots a real @underload/service server with:
//   - the actual result endpoint route
//     (/v1/comfy/workflows/:id/generate/:generate_id/result/:index)
//   - the actual /v1/comfy/media static mount (same shape as server.ts)
//
// …and verifies the full file-backed chain a browser takes for
// <img src>/<video src>:
//
//   result json ("file:0.mp4")
//     → GET …/result/0                       → 302, root-relative Location
//     → GET /v1/comfy/media/…/0.mp4          → 200, streamed bytes
//     → GET …/result/0 + Range (followed)    → 206, exact slice (video seeking)
//
// This is the regression test for "results live as FILES, the endpoint only
// redirects" — the behavior that keeps megabytes of base64 out of the JSON
// read/parse path on every media request.
// =============================================================================

// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, type ServerInstance } from '@underload/service';
import {
    generationFilePath,
    persistResultAssets,
    writeGenerationFile,
    type GenerationEntry
} from './generation-store';

const WORKFLOW_ID = 'wf-e2e';
const GENERATION_ID = 'gen-e2e';
const LEGACY_GENERATION_ID = 'gen-legacy';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULT_ROUTE_FILE = path.join(__dirname, 'service-route-result.ts');

// Extension allow-list mirrors the one registered in @underload/service's
// server.ts for /v1/comfy/media.
const MEDIA_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov', '.mp3', '.wav'];

const VIDEO_BYTES = Buffer.alloc(8192);
for (let i = 0; i < VIDEO_BYTES.length; i++) VIDEO_BYTES[i] = i % 251;

let tmpRoot: string;
let server: ServerInstance | null = null;
let port = 0;

/** Grab an ephemeral port, released before the server binds it. */
function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            const p = typeof address === 'object' && address ? address.port : 0;
            probe.close(() => resolve(p));
        });
        probe.on('error', reject);
    });
}

const resultUrl = (index: number, generateId = GENERATION_ID) =>
    `http://127.0.0.1:${port}/v1/comfy/workflows/${WORKFLOW_ID}/generate/${generateId}/result/${index}`;

/** Seed a generation json directly (no asset persistence). */
function seedGenerationJson(generateId: string, result: GenerationEntry['result']) {
    fs.mkdirSync(path.dirname(generationFilePath(tmpRoot, WORKFLOW_ID, generateId)), { recursive: true });
    const entry: GenerationEntry = {
        id: generateId,
        status: 'completed',
        createdDate: '2026-08-01T00:00:00.000Z',
        completedDate: '2026-08-01T00:00:10.000Z',
        generatedTime: '10.0s',
        error: null,
        prompt: {},
        result
    };
    writeGenerationFile(tmpRoot, WORKFLOW_ID, generateId, entry);
}

beforeAll(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-result-e2e-'));

    // Write path, exactly as cloud-prompt's background consumer does it:
    // capture data: → persist assets to files → store the json reference.
    const results = persistResultAssets(tmpRoot, WORKFLOW_ID, GENERATION_ID, [
        {
            type: 'video',
            url: `data:video/mp4;base64,${VIDEO_BYTES.toString('base64')}`,
            mimeType: 'video/mp4',
            size: VIDEO_BYTES.length,
            nodeId: '9'
        }
    ]);
    expect(results[0].url).toBe('file:0.mp4');
    seedGenerationJson(GENERATION_ID, results);

    // A LEGACY generation, as written before file-backed storage existed:
    // its result payload sits inline in the json as base64. The server's
    // read paths must migrate it to files on first touch.
    seedGenerationJson(LEGACY_GENERATION_ID, [
        {
            type: 'video',
            url: `data:video/mp4;base64,${VIDEO_BYTES.toString('base64')}`,
            mimeType: 'video/mp4',
            size: VIDEO_BYTES.length,
            nodeId: '9'
        }
    ]);

    port = await freePort();
    server = await startServer({
        root: tmpRoot,
        endpoints: [{ folderPath: __dirname, filePath: RESULT_ROUTE_FILE }],
        staticRoutes: [
            {
                route: '/v1/comfy/media',
                root: path.join(tmpRoot, 'temporary', 'database', 'comfy-workflows'),
                extensions: MEDIA_EXTENSIONS
            }
        ],
        port,
        host: '127.0.0.1'
    });
}, 30000);

afterAll(async () => {
    await server?.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('file-backed result — endpoint → 302 → static mount', () => {
    it('the endpoint answers 302 with a root-relative Location (host-agnostic for LAN)', async () => {
        const res = await fetch(resultUrl(0), { redirect: 'manual' });
        expect(res.status).toBe(302);
        expect(res.headers.get('location')).toBe(
            `/v1/comfy/media/${WORKFLOW_ID}/generation/${GENERATION_ID}/0.mp4`
        );
    });

    it('following the redirect streams the exact media bytes off disk', async () => {
        const res = await fetch(resultUrl(0)); // redirect: follow (default)
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('video/mp4');
        const body = Buffer.from(await res.arrayBuffer());
        expect(body.equals(VIDEO_BYTES)).toBe(true);
    });

    it('a Range request through the chain answers 206 with the exact slice (video seeking)', async () => {
        const res = await fetch(resultUrl(0), { headers: { Range: 'bytes=100-199' } });
        expect(res.status).toBe(206);
        const body = Buffer.from(await res.arrayBuffer());
        expect(body.equals(VIDEO_BYTES.subarray(100, 200))).toBe(true);
    });

    it('keeps the stored generation json free of base64 payloads', () => {
        const raw = fs.readFileSync(generationFilePath(tmpRoot, WORKFLOW_ID, GENERATION_ID), 'utf-8');
        expect(raw).toContain('file:0.mp4');
        expect(raw).not.toContain('base64');
    });

    it('404s cleanly for an unknown result index', async () => {
        const res = await fetch(resultUrl(7));
        expect(res.status).toBe(404);
    });
});

describe('legacy inline-base64 generation — migrated on first read', () => {
    it('converts the stored json to file references and serves the bytes off disk', async () => {
        // Before: the json holds the payload inline.
        const before = fs.readFileSync(generationFilePath(tmpRoot, WORKFLOW_ID, LEGACY_GENERATION_ID), 'utf-8');
        expect(before).toContain('base64');

        // First read → migration → redirect…
        const redirect = await fetch(resultUrl(0, LEGACY_GENERATION_ID), { redirect: 'manual' });
        expect(redirect.status).toBe(302);
        expect(redirect.headers.get('location')).toBe(
            `/v1/comfy/media/${WORKFLOW_ID}/generation/${LEGACY_GENERATION_ID}/0.mp4`
        );

        // …the json is rewritten with file references (no base64 left)…
        const after = fs.readFileSync(generationFilePath(tmpRoot, WORKFLOW_ID, LEGACY_GENERATION_ID), 'utf-8');
        expect(after).toContain('file:0.mp4');
        expect(after).not.toContain('base64');

        // …and following the chain streams the exact bytes off disk.
        const res = await fetch(resultUrl(0, LEGACY_GENERATION_ID));
        expect(res.status).toBe(200);
        const body = Buffer.from(await res.arrayBuffer());
        expect(body.equals(VIDEO_BYTES)).toBe(true);
    });
});
