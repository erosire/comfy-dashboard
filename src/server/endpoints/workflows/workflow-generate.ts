// Workflow generate endpoint
//
// POST — Creates a generation snapshot with metadata:
//   temporary/database/comfy-workflows/YYYYMMDD-HHMMSS/
//     ├── workflow.json
//     ├── meta.json
//     └── generation/
//           └── YYYYMMDD-HHMMSS.json   ← { id, status, createdDate, prompt, ... }
//
// GET — Lists all generation files for the workflow.

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

type GenerationResultItem = {
    type: 'image' | 'video';
    url: string;
    mimeType: string;
    size: number;
    nodeId: string;
};

type GenerationEntry = {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdDate: string;
    completedDate: string | null;
    generatedTime: string | null;
    error: string | null;
    prompt: Record<string, unknown>;
    result: GenerationResultItem[];
};

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

/** GET — List all generations for a workflow. */
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
    const generations: GenerationEntry[] = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
            const raw = fs.readFileSync(path.join(generationDir, entry.name), 'utf-8');
            const data = JSON.parse(raw);
            generations.push({
                id: data.id ?? entry.name.replace('.json', ''),
                status: data.status ?? 'pending',
                createdDate: data.createdDate ?? '',
                completedDate: data.completedDate ?? null,
                generatedTime: data.generatedTime ?? null,
                error: data.error ?? null,
                prompt: data.prompt ?? {},
                result: Array.isArray(data.result) ? data.result : []
            });
        } catch {
            // Skip corrupted files
        }
    }

    // Sort by createdDate descending (newest first)
    generations.sort((a, b) => (b.createdDate || '').localeCompare(a.createdDate || ''));

    return { status: 200, response: { generations } };
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

    // Read the workflow.json
    let workflowData: Record<string, unknown>;
    try {
        workflowData = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
    } catch {
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
        prompt: workflowData,
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

    const generationDir = path.join(
        projectRoot, 'temporary/database/comfy-workflows', workflowId, 'generation'
    );
    const filePath = path.join(generationDir, `${generateId}.json`);

    if (!fs.existsSync(filePath)) {
        return { status: 404, response: { error: `Generation '${generateId}' not found` } };
    }

    // Read existing generation
    let existing: GenerationEntry;
    try {
        existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return { status: 500, response: { error: 'Failed to read generation file' } };
    }

    // Parse the request body from parameters.body
    const body = (parameters.body ?? {}) as Record<string, unknown>;

    // Merge updates — only overwrite provided fields
    if (body.status !== undefined) existing.status = body.status as GenerationEntry['status'];
    if (body.completedDate !== undefined) existing.completedDate = body.completedDate as string | null;
    if (body.generatedTime !== undefined) existing.generatedTime = body.generatedTime as string | null;
    if (body.error !== undefined) existing.error = body.error as string | null;
    if (body.result !== undefined) existing.result = body.result as GenerationResultItem[];

    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');

    return {
        status: 200,
        response: {
            generation: existing
        }
    };
});
