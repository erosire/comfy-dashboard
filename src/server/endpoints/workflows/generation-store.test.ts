// =============================================================================
// Generation store — file-backed result assets
//
// persistResultAssets moves inline `data:` base64 payloads out of the
// generation json into plain asset files:
//   temporary/database/comfy-workflows/<wf>/generation/<gen>/<index>.<ext>
// and returns result items carrying `file:` references instead. The result
// endpoint 302-redirects those to the static /v1/comfy/media mount.
//
// Verifies:
//   1. data: payloads land on disk with index names + per-mime extensions,
//      exact bytes, normalized mime/size, and `file:` references.
//   2. Non-data urls (remote http(s), already file:) pass through untouched.
//   3. deleteGenerationFiles removes the assets folder with the json/log.
// =============================================================================

// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    deleteGenerationFiles,
    generationAssetsDirPath,
    generationFilePath,
    migrateGenerationAssets,
    persistResultAssets,
    readGenerationFile,
    writeGenerationFile,
    type GenerationEntry,
    type GenerationResultItem
} from './generation-store';
import { workflowGenerateResultGet } from './workflow-result';

const WORKFLOW_ID = 'wf-store-test';
const GENERATION_ID = 'gen-store-test';

let tmpRoot: string;

function assetsDir(): string {
    return generationAssetsDirPath(tmpRoot, WORKFLOW_ID, GENERATION_ID);
}

function makeEntry(result: GenerationResultItem[]): GenerationEntry {
    return {
        id: GENERATION_ID,
        status: 'completed',
        createdDate: '2026-08-01T00:00:00.000Z',
        completedDate: '2026-08-01T00:00:10.000Z',
        generatedTime: '10.0s',
        error: null,
        prompt: {},
        result
    };
}

/** Create the generation dir + write the entry (the POST endpoint's flow). */
async function seedEntry(result: GenerationResultItem[]): Promise<void> {
    fs.mkdirSync(path.dirname(assetsDir()), { recursive: true });
    await writeGenerationFile(tmpRoot, WORKFLOW_ID, GENERATION_ID, makeEntry(result));
}

// Minimal Hono-context stand-in: the result handler only reads headers.
function makeContext() {
    return {
        req: { header: (_name: string) => undefined }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function makeParams(index: number) {
    return {
        path: { id: WORKFLOW_ID, generate_id: GENERATION_ID, index },
        query: {},
        body: {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generation-store-test-'));
});

afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('persistResultAssets', () => {
    it('writes data: payloads to index-named asset files and returns file: references', async () => {
        const pngBytes = Buffer.from('fake-png-bytes');
        const mp4Bytes = Buffer.from('fake-mp4-bytes!!');
        const mp3Bytes = Buffer.from('fake-mp3-bytes!');

        const results: GenerationResultItem[] = [
            { type: 'image', url: `data:image/png;base64,${pngBytes.toString('base64')}`, mimeType: 'image/png', size: 0, nodeId: '1' },
            { type: 'video', url: `data:video/mp4;base64,${mp4Bytes.toString('base64')}`, mimeType: 'video/mp4', size: 0, nodeId: '2' },
            { type: 'audio', url: `data:audio/mpeg;base64,${mp3Bytes.toString('base64')}`, mimeType: 'audio/mpeg', size: 0, nodeId: '3' }
        ];

        const persisted = await persistResultAssets(tmpRoot, WORKFLOW_ID, GENERATION_ID, results);

        expect(persisted.map((r) => r.url)).toEqual(['file:0.png', 'file:1.mp4', 'file:2.mp3']);
        expect(persisted.map((r) => r.size)).toEqual([pngBytes.length, mp4Bytes.length, mp3Bytes.length]);

        // The files on disk hold exactly the decoded bytes.
        expect(fs.readFileSync(path.join(assetsDir(), '0.png')).equals(pngBytes)).toBe(true);
        expect(fs.readFileSync(path.join(assetsDir(), '1.mp4')).equals(mp4Bytes)).toBe(true);
        expect(fs.readFileSync(path.join(assetsDir(), '2.mp3')).equals(mp3Bytes)).toBe(true);
    });

    it('normalizes the mimeType from the data: meta when the item lacks one', async () => {
        const results: GenerationResultItem[] = [
            { type: 'image', url: 'data:image/jpeg;base64,AAAA', mimeType: '', size: 0, nodeId: '' }
        ];
        const persisted = await persistResultAssets(tmpRoot, WORKFLOW_ID, GENERATION_ID, results);
        expect(persisted[0].mimeType).toBe('image/jpeg');
        expect(persisted[0].url).toBe('file:0.jpg');
    });

    it('leaves remote http(s) and already file-backed items untouched', async () => {
        const results: GenerationResultItem[] = [
            { type: 'video', url: 'https://cdn.example.com/a.mp4', mimeType: 'video/mp4', size: 1, nodeId: '1' },
            { type: 'image', url: 'file:1.png', mimeType: 'image/png', size: 2, nodeId: '2' }
        ];
        const persisted = await persistResultAssets(tmpRoot, WORKFLOW_ID, GENERATION_ID, results);
        expect(persisted).toEqual(results);
        expect(fs.existsSync(assetsDir())).toBe(false);
    });

    it('keeps a malformed data: payload inline rather than writing garbage', async () => {
        const results: GenerationResultItem[] = [
            { type: 'image', url: 'data:image/png;base64', mimeType: 'image/png', size: 0, nodeId: '1' } // no comma
        ];
        const persisted = await persistResultAssets(tmpRoot, WORKFLOW_ID, GENERATION_ID, results);
        expect(persisted[0].url).toBe(results[0].url);
        expect(fs.existsSync(assetsDir())).toBe(false);
    });
});

describe('deleteGenerationFiles', () => {
    it('removes the json, the log, and the media assets folder', async () => {
        await seedEntry([
            { type: 'image', url: 'file:0.png', mimeType: 'image/png', size: 1, nodeId: '1' }
        ]);
        await persistResultAssets(tmpRoot, WORKFLOW_ID, GENERATION_ID, [
            { type: 'image', url: 'data:image/png;base64,AAAA', mimeType: 'image/png', size: 1, nodeId: '1' }
        ]);
        expect(fs.existsSync(path.join(assetsDir(), '0.png'))).toBe(true);

        expect(await deleteGenerationFiles(tmpRoot, WORKFLOW_ID, GENERATION_ID)).toBe(true);

        expect(await readGenerationFile(tmpRoot, WORKFLOW_ID, GENERATION_ID)).toBeNull();
        expect(fs.existsSync(assetsDir())).toBe(false);
    });

    it('returns false when the generation json does not exist', async () => {
        expect(await deleteGenerationFiles(tmpRoot, WORKFLOW_ID, GENERATION_ID)).toBe(false);
    });
});

describe('migrateGenerationAssets', () => {
    it('converts inline base64 results to asset files and rewrites the json once', async () => {
        const bytes = Buffer.from('legacy-payload');
        await seedEntry([
            { type: 'image', url: `data:image/png;base64,${bytes.toString('base64')}`, mimeType: 'image/png', size: 0, nodeId: '1' }
        ]);

        const loaded = (await readGenerationFile(tmpRoot, WORKFLOW_ID, GENERATION_ID))!;
        const migrated = await migrateGenerationAssets(tmpRoot, WORKFLOW_ID, GENERATION_ID, loaded);

        // Returned entry carries file references…
        expect(migrated.result[0].url).toBe('file:0.png');
        expect(migrated.result[0].size).toBe(bytes.length);
        // …the bytes are on disk as a plain file…
        expect(fs.readFileSync(path.join(assetsDir(), '0.png')).equals(bytes)).toBe(true);
        // …and the stored json was rewritten: no base64 remains.
        const stored = (await readGenerationFile(tmpRoot, WORKFLOW_ID, GENERATION_ID))!;
        expect(stored.result[0].url).toBe('file:0.png');
        const rawJson = fs.readFileSync(generationFilePath(tmpRoot, WORKFLOW_ID, GENERATION_ID), 'utf-8');
        expect(rawJson).not.toContain('base64');
    });

    it('is a no-op for generations already holding only file:/remote references', async () => {
        await seedEntry([
            { type: 'image', url: 'file:0.png', mimeType: 'image/png', size: 1, nodeId: '1' },
            { type: 'video', url: 'https://cdn.example.com/a.mp4', mimeType: 'video/mp4', size: 2, nodeId: '2' }
        ]);
        const before = fs.readFileSync(generationFilePath(tmpRoot, WORKFLOW_ID, GENERATION_ID), 'utf-8');

        const loaded = (await readGenerationFile(tmpRoot, WORKFLOW_ID, GENERATION_ID))!;
        const migrated = await migrateGenerationAssets(tmpRoot, WORKFLOW_ID, GENERATION_ID, loaded);

        expect(migrated).toBe(loaded); // untouched — same object
        expect(fs.readFileSync(generationFilePath(tmpRoot, WORKFLOW_ID, GENERATION_ID), 'utf-8')).toBe(before);
        expect(fs.existsSync(assetsDir())).toBe(false);
    });
});

describe('file-backed round trip (persist → json → result endpoint)', () => {
    it('serves a persisted result through the endpoint as a media-mount 302', async () => {
        // Write path: persist first (as cloud-prompt / PUT do), then store.
        const results = await persistResultAssets(tmpRoot, WORKFLOW_ID, GENERATION_ID, [
            { type: 'video', url: 'data:video/mp4;base64,AAAA', mimeType: 'video/mp4', size: 3, nodeId: '9' }
        ]);
        await seedEntry(results);

        // The stored json carries only the small reference — no base64.
        const stored = await readGenerationFile(tmpRoot, WORKFLOW_ID, GENERATION_ID);
        expect(stored?.result[0].url).toBe('file:0.mp4');

        // Retrieval path: redirect to the static mount, no buffering here.
        const out = await workflowGenerateResultGet(makeContext(), makeParams(0), { root: tmpRoot });
        expect(out.status).toBe(302);
        expect(out.raw!.headers.get('location')).toBe(
            `/v1/comfy/media/${WORKFLOW_ID}/generation/${GENERATION_ID}/0.mp4`
        );
    });
});
