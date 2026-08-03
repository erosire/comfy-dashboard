// Workflow generate endpoint
//
// POST — Creates a generation snapshot with metadata:
//   <database-root>/comfy-workflows/YYYYMMDD-HHMMSS/
//     ├── workflow.json
//     ├── meta.json
//     └── generation/
//           ├── YYYYMMDD-HHMMSS.json   ← { id, status, createdDate, prompt, result, ... }
//           ├── YYYYMMDD-HHMMSS.log    ← timestamped processing log, written by
//           │                            POST /v1/comfy/cloud/prompt while it
//           │                            consumes the pod's NDJSON stream. This
//           │                            log (not the json) is the event trail.
//           └── YYYYMMDD-HHMMSS/       ← media asset files (0.png, 1.mp4, ...) —
//                                        the result payloads, referenced from the
//                                        json's result[].url as "file:<index>.<ext>"
//                                        and served via the /v1/comfy/media mount.
//
//   The snapshotted prompt is the request's optional { prompt } body when
//   provided — the UI sends its serialized ORIGINAL workflow json (v0.4/v1
//   editor format, with every widget edit) — falling back to the stored
//   workflow.json otherwise. It stays lossless: consumers submitting to a
//   Comfy Cloud pod (POST /v1/comfy/cloud/prompt) convert it to the flat
//   API prompt server-side at submission time.
//
//   The request's optional { name } body names the generation — it becomes
//   the generation id (the json/log file's base name) after sanitization.
//   When omitted, the timestamp (YYYYMMDD-HHMMSS) is used, as before. The
//   UI defaults to "<workflow name>_<local timestamp>".
//
// GET (list) — Lists all generation files for the workflow as lightweight
//   GenerationSummary entries (id, status, timestamps, resultCount,
//   resultItems). The heavy prompt / result payloads are omitted so the
//   list loads fast; fetch the full entry with GET .../generate/{generate_id}.
//
// GET (one)  — Returns the complete GenerationEntry (prompt + result) for a
//   single generate_id. Used when the agent needs the snapshotted prompt.
//
// DELETE     — Removes a generation snapshot: the json record, its sibling
//   .log event trail, and its media assets folder. Deleting a still-processing
//   generation does not cancel its pod run — the background stream consumer
//   simply no-ops on the missing file.

import fs from 'node:fs/promises';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';
import {
    deleteGenerationFiles,
    migrateGenerationAssets,
    patchGenerationFile,
    persistResultAssets,
    readGenerationFile,
    toGenerationSummary,
    type GenerationEntry,
    type GenerationPatch,
    type GenerationSummary
} from './generation-store';

/** Async existence probe (replaces fs.existsSync on the event loop). */
async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

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

/**
 * Make a caller-provided generation name safe as a file/id base: strips
 * characters that are invalid on Windows/POSIX filesystems, collapses
 * whitespace runs to a single underscore, and caps the length. Returns ''
 * when nothing usable survives — the caller then falls back to the
 * timestamped default id.
 */
function sanitizeGenerationName(name: string): string {
    return name
        .trim()
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-') // filesystem-forbidden + control chars
        .replace(/\s+/g, '_') // whitespace runs → single underscore
        .replace(/^\.+/, '') // no leading dots (hidden on POSIX)
        .replace(/\.+$/, '') // no trailing dots (invalid on Windows)
        .slice(0, 150);
}

/** GET — List all generations for a workflow as lightweight summaries. */
export const workflowGenerateList = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    const generationDir = path.join(
        projectRoot, 'comfy-workflows', workflowId, 'generation'
    );

    // Async readdir — a missing folder is just an empty list.
    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(generationDir, { withFileTypes: true });
    } catch {
        return { status: 200, response: { generations: [] } };
    }

    // Read + project every generation CONCURRENTLY (this endpoint is polled
    // while generations run — sequential sync reads used to serialize the
    // whole directory scan into the event loop on every poll).
    //
    // readGenerationFile normalizes older files and returns null for
    // missing/corrupted entries — skip those. We project to a summary so
    // the list never carries the heavy prompt/result/stream fields.
    // Heal legacy inline-base64 results as the list sweeps by — each
    // migration is a one-time file write + json rewrite; afterwards the
    // generation only carries `file:` references.
    const summaries = (
        await Promise.all(
            entries
                .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
                .map(async (entry) => {
                    const genId = entry.name.replace('.json', '');
                    const full = await readGenerationFile(projectRoot, workflowId, genId);
                    if (!full) return null;
                    return toGenerationSummary(await migrateGenerationAssets(projectRoot, workflowId, genId, full));
                })
        )
    ).filter((s): s is GenerationSummary => s !== null);

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

    const entry = await readGenerationFile(projectRoot, workflowId, generateId);
    if (!entry) {
        return { status: 404, response: { error: `Generation '${generateId}' not found` } };
    }

    // Heal legacy inline-base64 results on read — the API never hands
    // base64 back out: the json is rewritten with file: references and the
    // media serves off disk.
    return { status: 200, response: { generation: await migrateGenerationAssets(projectRoot, workflowId, generateId, entry) } };
});

/** POST — Create a new generation snapshot. */
export const workflowGenerateCreate = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    const workflowDir = path.join(
        projectRoot, 'comfy-workflows', workflowId
    );
    const workflowJsonPath = path.join(workflowDir, 'workflow.json');

    if (!(await pathExists(workflowJsonPath))) {
        return { status: 404, response: { error: `Workflow '${workflowId}' not found` } };
    }

    // Read the workflow.json — the default snapshot source
    let workflowData: Record<string, unknown> | null = null;
    try {
        workflowData = JSON.parse(await fs.readFile(workflowJsonPath, 'utf-8'));
    } catch {
        // Tolerated when the request supplies its own prompt below
    }

    // Optional request body:
    //   { prompt } — snapshot THIS instead of the stored workflow.json.
    //     The UI sends its serialized ORIGINAL workflow json (v0.4/v1
    //     editor format — widget edits and prompt-field selection included),
    //     so the generation captures exactly what the user sees, lossless.
    //     Omitting it keeps the original behavior.
    //   { name } — names the generation: the sanitized name becomes the
    //     generation id (the json/log files' base name). When omitted, or
    //     nothing filename-safe survives, the timestamp stays the default.
    const body = (parameters.body ?? {}) as { prompt?: Record<string, unknown>; name?: string };
    const promptData =
        body.prompt && typeof body.prompt === 'object' && !Array.isArray(body.prompt)
            ? body.prompt
            : workflowData;

    if (!promptData) {
        return { status: 500, response: { error: 'Failed to read workflow.json' } };
    }

    // Generate the ID — caller-provided name when given, timestamp otherwise.
    const now = new Date();
    const nowIso = now.toISOString();
    const requestedName = typeof body.name === 'string' ? sanitizeGenerationName(body.name) : '';
    const genId = requestedName || timestampFile(now);

    // Ensure the generation subfolder exists
    const generationDir = path.join(workflowDir, 'generation');
    await fs.mkdir(generationDir, { recursive: true });

    // Handle filename collision with a counter suffix
    let filename = `${genId}.json`;
    let filePath = path.join(generationDir, filename);
    let counter = 1;
    while (await pathExists(filePath)) {
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

    await fs.writeFile(filePath, JSON.stringify(generation, null, 2), 'utf-8');

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

    // A result array carrying inline `data:` payloads is first persisted to
    // asset files on disk — the stored json keeps only `file:` references,
    // so generation files stay small regardless of the write path.
    if (body.result !== undefined) {
        body.result = await persistResultAssets(projectRoot, workflowId, generateId, body.result);
    }

    // Merge updates — only overwrite provided fields
    const existing = await patchGenerationFile(projectRoot, workflowId, generateId, body);
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

/** DELETE — Remove a generation snapshot (json + sibling .log trail). */
export const workflowGenerateDelete = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;
    const generateId = parameters.path.generate_id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }
    if (!generateId) {
        return { status: 400, response: { error: 'generate_id is required' } };
    }

    if (!(await deleteGenerationFiles(projectRoot, workflowId, generateId))) {
        return { status: 404, response: { error: `Generation '${generateId}' not found` } };
    }

    return { status: 200, response: { success: true, id: generateId } };
});
