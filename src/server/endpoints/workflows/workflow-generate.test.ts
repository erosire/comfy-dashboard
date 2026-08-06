// =============================================================================
// Workflow generation endpoint tests
//
// The generation POST owns the workflow activity timestamp. Creating a new
// generation must update the parent meta.modifiedDate so GET /workflows sorts
// that workflow first on the next request, including requests from another UI.
// =============================================================================

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workflowGenerateCreate } from './workflow-generate';

const WORKFLOW_ID = 'workflow-123';
let tmpRoot: string;

function makeParams(body: Record<string, unknown> = {}) {
    // The service handler only reads the path and body fields in this test;
    // the cast keeps the fixture focused on the endpoint contract.
    return {
        path: { id: WORKFLOW_ID },
        query: {},
        body
    } as any;
}

function workflowDir(): string {
    return path.join(tmpRoot, 'comfy-workflows', WORKFLOW_ID);
}

function seedWorkflow(modifiedDate: string): void {
    // Seed both files because production creation requires workflow.json and
    // the list endpoint reads meta.json for modifiedDate.
    fs.mkdirSync(path.join(workflowDir(), 'generation'), { recursive: true });
    fs.writeFileSync(path.join(workflowDir(), 'workflow.json'), JSON.stringify({ nodes: [] }), 'utf-8');
    fs.writeFileSync(
        path.join(workflowDir(), 'meta.json'),
        JSON.stringify({
            id: WORKFLOW_ID,
            name: 'Test workflow',
            description: null,
            nodeCount: 0,
            createdDate: '2026-08-01T00:00:00.000Z',
            modifiedDate,
            tags: [],
            inputFields: []
        }),
        'utf-8'
    );
}

function readMeta(): { createdDate: string; modifiedDate: string } {
    return JSON.parse(fs.readFileSync(path.join(workflowDir(), 'meta.json'), 'utf-8'));
}

beforeEach(() => {
    // A fixed clock makes the generated timestamp and persisted modifiedDate
    // exact, avoiding a timing-sensitive assertion around Date.now().
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-06T12:34:56.789Z'));
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-generate-test-'));
    seedWorkflow('2026-08-01T00:00:00.000Z');
});

afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('workflowGenerateCreate workflow recency', () => {
    it('updates meta.modifiedDate to the generation createdDate', async () => {
        const out = await workflowGenerateCreate(
            {} as any,
            makeParams({ prompt: { nodes: [] }, name: 'run' }),
            { root: tmpRoot }
        );

        expect(out.status).toBe(200);
        const generation = (out.response as { generation: { createdDate: string } }).generation;
        expect(generation.createdDate).toBe('2026-08-06T12:34:56.789Z');
        expect(readMeta()).toMatchObject({
            createdDate: '2026-08-01T00:00:00.000Z',
            modifiedDate: '2026-08-06T12:34:56.789Z'
        });
    });

    it('keeps the workflow recency update when the generation id needs a collision suffix', async () => {
        fs.writeFileSync(
            path.join(workflowDir(), 'generation', 'run.json'),
            JSON.stringify({ existing: true }),
            'utf-8'
        );

        const out = await workflowGenerateCreate(
            {} as any,
            makeParams({ prompt: { nodes: [] }, name: 'run' }),
            { root: tmpRoot }
        );

        expect(out.status).toBe(200);
        expect((out.response as { generation: { id: string } }).generation.id).toBe('run-01');
        expect(readMeta().modifiedDate).toBe('2026-08-06T12:34:56.789Z');
    });
});
