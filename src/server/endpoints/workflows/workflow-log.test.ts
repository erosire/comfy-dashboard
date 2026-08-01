// =============================================================================
// Generation log endpoint tests
//
// GET /v1/comfy/workflows/:id/generate/:generate_id/log
// (workflowGenerateLogGet in workflow-log.ts) serves a generation's .log
// event trail for debugging. Contract:
//
//   1. A generation with a .log file gets its content back verbatim.
//   2. A generation WITHOUT a .log file (pre-log, or written outside the
//      cloud prompt endpoint) gets a trail synthesized from its json —
//      status, timing, and error message are all present.
//   3. Logs larger than LOG_RESPONSE_MAX_BYTES are tail-truncated with a
//      notice (the recent lines carrying the terminal error survive).
//   4. Unknown generations 404; missing path params 400.
// =============================================================================

// @vitest-environment node

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workflowGenerateLogGet, LOG_RESPONSE_MAX_BYTES } from './workflow-log';
import { generationLogPath } from './generation-store';

const WORKFLOW_ID = 'wf-test';
const GENERATION_ID = 'gen-test';

let tmpRoot: string;

function makeParams(overrides: { id?: string; generate_id?: string } = {}) {
    return {
        path: { id: WORKFLOW_ID, generate_id: GENERATION_ID, ...overrides },
        query: {},
        body: {}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function seedGeneration(entry: Record<string, unknown>, logContent?: string) {
    const dir = path.join(tmpRoot, 'temporary/database/comfy-workflows', WORKFLOW_ID, 'generation');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, `${GENERATION_ID}.json`),
        JSON.stringify({
            id: GENERATION_ID,
            status: 'failed',
            createdDate: '2026-08-01T00:00:00.000Z',
            completedDate: '2026-08-01T00:00:10.000Z',
            generatedTime: '10.0s',
            error: 'KSampler exploded',
            prompt: {},
            result: [],
            ...entry
        }),
        'utf-8'
    );
    if (logContent !== undefined) {
        fs.writeFileSync(generationLogPath(tmpRoot, WORKFLOW_ID, GENERATION_ID), logContent, 'utf-8');
    }
}

beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-log-test-'));
});

afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('workflowGenerateLogGet', () => {
    it('returns the .log content verbatim for a generation with a log file', async () => {
        const logContent =
            '[2026-08-01T00:00:00.000Z] Generation started — submitting to https://pod:8188/\n' +
            '[2026-08-01T00:00:01.000Z] Enqueued — prompt_id: abc\n' +
            '[2026-08-01T00:00:10.000Z] Terminal error (execution_error): KSampler exploded\n';
        seedGeneration({}, logContent);

        const out = await workflowGenerateLogGet({} as any, makeParams(), { root: tmpRoot });
        expect(out.status).toBe(200);
        expect((out.response as { log: string }).log).toBe(logContent);
    });

    it('synthesizes a trail from the json when no .log file exists (keeps status + error)', async () => {
        seedGeneration({}); // no log file

        const out = await workflowGenerateLogGet({} as any, makeParams(), { root: tmpRoot });
        expect(out.status).toBe(200);
        const { log } = out.response as { log: string };
        expect(log).toContain('synthesized');
        expect(log).toContain('[2026-08-01T00:00:00.000Z] Generation created');
        expect(log).toContain('[2026-08-01T00:00:10.000Z] Generation FAILED in 10.0s');
        expect(log).toContain('Error: KSampler exploded');
    });

    it('synthesizes a not-finished line for a generation without completedDate', async () => {
        seedGeneration({ status: 'processing', completedDate: null, generatedTime: null, error: null });

        const out = await workflowGenerateLogGet({} as any, makeParams(), { root: tmpRoot });
        const { log } = out.response as { log: string };
        expect(log).toContain('Current status: processing (not finished)');
        expect(log).not.toContain('Error:');
    });

    it('tail-truncates oversized logs with a notice, keeping the recent end', async () => {
        // One oversized line longer than the cap, then a marker tail.
        const marker = 'END-OF-LOG-MARKER';
        const fillerLine = `[2026-08-01T00:00:05.000Z] Event: progress ${'x'.repeat(200)}\n`;
        let big = '';
        while (Buffer.byteLength(big) <= LOG_RESPONSE_MAX_BYTES + 4096) big += fillerLine;
        big += `[2026-08-01T00:00:10.000Z] Generation FAILED: boom ${marker}\n`;
        seedGeneration({}, big);

        const out = await workflowGenerateLogGet({} as any, makeParams(), { root: tmpRoot });
        expect(out.status).toBe(200);
        const { log } = out.response as { log: string };
        expect(log.startsWith('(log truncated')).toBe(true);
        expect(log).toContain(marker);
        // The response stays near the cap, far below the original size.
        expect(Buffer.byteLength(log)).toBeLessThan(Buffer.byteLength(big));
    });

    it('404s for an unknown generation', async () => {
        seedGeneration({});
        const out = await workflowGenerateLogGet(
            {} as any,
            makeParams({ generate_id: 'nope' }),
            { root: tmpRoot }
        );
        expect(out.status).toBe(404);
    });

    it('400s when id or generate_id is missing', async () => {
        seedGeneration({});
        const noId = await workflowGenerateLogGet({} as any, makeParams({ id: '' }), { root: tmpRoot });
        expect(noId.status).toBe(400);
        const noGen = await workflowGenerateLogGet({} as any, makeParams({ generate_id: '' }), { root: tmpRoot });
        expect(noGen.status).toBe(400);
    });
});
