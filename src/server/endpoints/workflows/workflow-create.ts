// Workflow create endpoint — POST /v1/comfy/workflows
//
// Creates a new workflow entry. Stores the workflow in a timestamped folder:
//   <database-root>/comfy-workflows/YYYYMMDD-HHMMSS/
//     ├── workflow.json   (ComfyUI-compatible workflow JSON)
//     └── meta.json       (dashboard metadata: name, description, tags, etc.)

import fs from 'node:fs/promises';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

/** Generate YYYYMMDD-HHMMSS folder name from a Date. */
function timestampFolder(date: Date): string {
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

/** Extract the ComfyUI-compatible workflow JSON from the raw input. */
function extractComfyWorkflow(raw: Record<string, unknown>): Record<string, unknown> {
    // If it already looks like a ComfyUI workflow (has nodes array), return as-is
    if ('nodes' in raw && Array.isArray(raw.nodes)) {
        return raw;
    }
    // If it's an API prompt format { "3": { class_type, inputs }, ... }
    // or wrapped { prompt: { ... } }, return as-is (it's still valid ComfyUI data)
    return raw;
}

/** Count nodes from raw workflow data (handles multiple ComfyUI formats). */
function countNodes(raw: Record<string, unknown>): number {
    const rawNodes = (raw as any).nodes;
    if (Array.isArray(rawNodes)) {
        return rawNodes.length;
    }
    const promptObj = (raw as any).prompt ?? raw;
    if (typeof promptObj === 'object' && promptObj !== null) {
        return Object.keys(promptObj).filter((k) => {
            const v = promptObj[k];
            return v && typeof v === 'object' && 'class_type' in v;
        }).length;
    }
    return 0;
}

/** Extract tags from node types in raw workflow data. */
function extractTags(raw: Record<string, unknown>): string[] {
    const rawNodes = (raw as any).nodes;
    const types = new Set<string>();

    if (Array.isArray(rawNodes)) {
        for (const node of rawNodes) {
            if (node.type) types.add(String(node.type).toLowerCase());
        }
    } else {
        const promptObj = (raw as any).prompt ?? raw;
        if (typeof promptObj === 'object' && promptObj !== null) {
            for (const [, value] of Object.entries(promptObj)) {
                const node = value as Record<string, unknown>;
                if (node && typeof node === 'object' && 'class_type' in node) {
                    types.add(String(node.class_type).toLowerCase());
                }
            }
        }
    }

    const tags: string[] = [];
    let i = 0;
    for (const t of types) {
        if (i >= 5) break;
        tags.push(t);
        i++;
    }
    return tags;
}

/** Async existence probe (replaces fs.existsSync on the event loop). */
async function pathExists(p: string): Promise<boolean> {
    try {
        await fs.access(p);
        return true;
    } catch {
        return false;
    }
}

/**
 * Extract the workflow's declared "Input" field keys — widget markings
 * the dashboard persists in raw.extra.inputFields (see the PROMPT tab's
 * Input chips). Mirrored into meta.json so the list endpoint can surface
 * "this workflow has Inputs" without parsing every workflow.json.
 */
function extractInputFields(raw: Record<string, unknown>): string[] {
    const saved = (raw as any)?.extra?.inputFields;
    if (!Array.isArray(saved)) return [];
    return saved.filter((key): key is string => typeof key === 'string');
}

export const workflowCreate = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const body = parameters.body as { name?: string; description?: string; raw?: Record<string, unknown> } | undefined;

    if (!body?.name) {
        return { status: 400, response: { error: 'name is required' } };
    }

    if (!body?.raw) {
        return { status: 400, response: { error: 'raw workflow JSON is required' } };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const nodeCount = countNodes(body.raw);
    const tags = extractTags(body.raw);
    const comfyWorkflow = extractComfyWorkflow(body.raw);

    // Generate folder name from timestamp; handle collisions with a counter suffix
    const baseFolder = timestampFolder(now);
    // The service injects temporary/database as projectRoot; this distribution
    // owns the comfy-workflows child directory.
    const databaseDir = path.join(projectRoot, 'comfy-workflows');
    await fs.mkdir(databaseDir, { recursive: true });

    let folderName = baseFolder;
    let folderPath = path.join(databaseDir, folderName);
    let counter = 1;
    while (await pathExists(folderPath)) {
        folderName = `${baseFolder}-${String(counter).padStart(2, '0')}`;
        folderPath = path.join(databaseDir, folderName);
        counter++;
    }

    await fs.mkdir(folderPath, { recursive: true });

    // workflow.json — pure ComfyUI-compatible workflow (drop-in ready)
    const workflowJsonPath = path.join(folderPath, 'workflow.json');
    await fs.writeFile(workflowJsonPath, JSON.stringify(comfyWorkflow, null, 2), 'utf-8');

    // meta.json — dashboard metadata
    const meta = {
        id: folderName,
        name: body.name,
        description: body.description ?? null,
        nodeCount,
        createdDate: nowIso,
        modifiedDate: nowIso,
        tags,
        inputFields: extractInputFields(body.raw)
    };
    const metaJsonPath = path.join(folderPath, 'meta.json');
    await fs.writeFile(metaJsonPath, JSON.stringify(meta, null, 2), 'utf-8');

    return {
        status: 200,
        response: {
            workflow: meta
        }
    };
});
