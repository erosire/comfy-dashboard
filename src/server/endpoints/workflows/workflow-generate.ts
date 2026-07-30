// Workflow generate endpoint
//
// POST — Creates a generation snapshot with metadata:
//   temporary/database/comfy-workflows/YYYYMMDD-HHMMSS/
//     ├── workflow.json
//     ├── meta.json
//     └── generation/
//           ├── YYYYMMDD-HHMMSS.json   ← { id, status, createdDate, prompt, result, ... }
//           └── YYYYMMDD-HHMMSS.log    ← timestamped processing log, written by
//                                        POST /v1/comfy/cloud/prompt while it
//                                        consumes the pod's NDJSON stream. This
//                                        log (not the json) is the event trail.
//
//   The snapshotted prompt is the request's optional { prompt } body when
//   provided (the UI sends the API prompt built from its live edited node
//   tree), falling back to the stored workflow.json otherwise.
//
// GET (list) — Lists all generation files for the workflow as lightweight
//   GenerationSummary entries (id, status, timestamps, resultCount,
//   resultItems). The heavy prompt / result payloads are omitted so the
//   list loads fast; fetch the full entry with GET .../generate/{generate_id}.
//
// GET (one)  — Returns the complete GenerationEntry (prompt + result) for a
//   single generate_id. Used when the agent needs the snapshotted prompt.

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';
import {
    patchGenerationFile,
    readGenerationFile,
    toGenerationSummary,
    type GenerationEntry,
    type GenerationPatch,
    type GenerationSummary
} from './generation-store';

function timestampFile(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        date.getFullYear().toString() +
        pad(date.getMonth() + 1) +
        pad(date.getDate()) +
        '-' +
        pad(date.getHours()) +
        pad(date.getMinutes()) +
        pad(date.getSeconds())
    );
}

/** GET — List all generations for a workflow as lightweight summaries. */
export const workflowGenerateList = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    const generationDir = path.join(
        projectRoot, 'temporary/database/comfy-workflows', workflowId, 'generation'
    );

    if (!fs.existsSync(generationDir)) {
        return { status: 200, response: { generations: [] } };
    }

    const entries = fs.readdirSync(generationDir, { withFileTypes: true });
    const summaries: GenerationSummary[] = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        // readGenerationFile normalizes older files and returns null for
        // missing/corrupted entries — skip those. We project to a summary
        // so the list never carries the heavy prompt/result/stream fields.
        const full = readGenerationFile(projectRoot, workflowId, entry.name.replace('.json', ''));
        if (!full) continue;
        summaries.push(toGenerationSummary(full));
    }

    // Sort by createdDate descending (newest first)
    summaries.sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''));

    return { status: 200, response: { generations: summaries } };
});

/** GET — Fetch a single generation entry (full data: prompt, result, stream). */
export const workflowGenerateGet = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;
    const generateId = parameters.path.generate_id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }
    if (!generateId) {
        return { status: 400, response: { error: 'generate_id is required' } };
    }

    const entry = readGenerationFile(projectRoot, workflowId, generateId);
    if (!entry) {
        return { status: 404, response: { error: `Generation '${generateId}' not found` } };
    }

    return { status: 200, response: { generation: entry } };
});

/** POST — Create a new generation snapshot. */
export const workflowGenerateCreate = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    const workflowDir = path.join(
        projectRoot, 'temporary/database/comfy-workflows', workflowId
    );
    const workflowJsonPath = path.join(workflowDir, 'workflow.json');

    if (!fs.existsSync(workflowJsonPath)) {
        return { status: 404, response: { error: `Workflow '${workflowId}' not found` } };
    }

    // Read the workflow.json — the default snapshot source
    let workflowData: Record<string, unknown> | null = null;
    try {
        workflowData = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
    } catch {
        // Tolerated when the request supplies its own prompt below
    }

    // Optional request body: { prompt } — snapshot THIS instead of the
    // stored workflow.json. The UI builds the prompt from its live editor
    // tree (including any widget edits), so the generation captures what
    // the user actually sees. Omitting it keeps the original behavior.
    const body = (parameters.body ?? {}) as { prompt?: Record<string, unknown> };
    const promptData =
        body.prompt && typeof body.prompt === 'object' && !Array.isArray(body.prompt)
            ? body.prompt
            : workflowData;

    if (!promptData) {
        return { status: 500, response: { error: 'Failed to read workflow.json' } };
    }

    // Generate timestamped ID
    const now = new Date();
    const nowIso = now.toISOString();
    const genId = timestampFile(now);

    // Ensure the generation subfolder exists
    const generationDir = path.join(workflowDir, 'generation');
    fs.mkdirSync(generationDir, { recursive: true });

    // Handle filename collision with a counter suffix
    let filename = `${genId}.json`;
    let filePath = path.join(generationDir, filename);
    let counter = 1;
    while (fs.existsSync(filePath)) {
        filename = `${genId}-${String(counter).padStart(2, '0')}.json`;
        filePath = path.join(generationDir, filename);
        counter++;
    }

    const actualId = filename.replace('.json', '');

    // Build the generation entry with metadata
    const generation: GenerationEntry = {
        id: actualId,
        status: 'pending',
        createdDate: nowIso,
        completedDate: null,
        generatedTime: null,
        error: null,
        prompt: promptData,
        result: []
    };

    fs.writeFileSync(filePath, JSON.stringify(generation, null, 2), 'utf-8');

    return {
        status: 200,
        response: {
            generation
        }
    };
});

/** PUT — Update a generation entry (e.g. with results after completion). */
export const workflowGenerateUpdate = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;
    const generateId = parameters.path.generate_id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }
    if (!generateId) {
        return { status: 400, response: { error: 'generate_id is required' } };
    }

    // Parse the request body from parameters.body
    const body = (parameters.body ?? {}) as GenerationPatch;

    // Merge updates — only overwrite provided fields
    const existing = patchGenerationFile(projectRoot, workflowId, generateId, body);
    if (!existing) {
        return { status: 404, response: { error: `Generation '${generateId}' not found` } };
    }

    return {
        status: 200,
        response: {
            generation: existing
        }
    };
});
