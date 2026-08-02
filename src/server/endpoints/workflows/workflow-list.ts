// Workflow list endpoint — GET /v1/comfy/workflows
//
// Returns all stored workflows from the local workflow database directory.
// Each workflow is a folder under temporary/database/comfy-workflows/:
//   YYYYMMDD-HHMMSS/
//     ├── workflow.json   (ComfyUI-compatible workflow JSON)
//     └── meta.json       (dashboard metadata)
//
// Sorted by modifiedDate descending (newest first).
// Supports optional query parameter:
//   ?q=<search>  — free-text search matching name, description, and tags

import fs from 'node:fs/promises';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

type WorkflowMeta = {
    id: string;
    name: string;
    description?: string;
    nodeCount: number;
    createdDate: string;
    modifiedDate: string;
    tags?: string[];
    /** Widget keys marked as Inputs (mirrored from raw.extra.inputFields). */
    inputFields?: string[];
};

/** Read one folder's meta.json; null when missing/corrupt (skipped). */
async function readMeta(databaseDir: string, folderName: string): Promise<WorkflowMeta | null> {
    try {
        const data = JSON.parse(await fs.readFile(path.join(databaseDir, folderName, 'meta.json'), 'utf-8'));
        return {
            id: data.id ?? folderName,
            name: data.name ?? 'Untitled Workflow',
            description: data.description,
            nodeCount: typeof data.nodeCount === 'number' ? data.nodeCount : 0,
            createdDate: data.createdDate ?? '',
            modifiedDate: data.modifiedDate ?? '',
            tags: Array.isArray(data.tags) ? data.tags : [],
            // Legacy metas predate the mirror — absent means no Inputs.
            inputFields: Array.isArray(data.inputFields) ? data.inputFields : []
        };
    } catch {
        return null;
    }
}

export const workflowList = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const databaseDir = path.join(projectRoot, 'temporary/database/comfy-workflows');
    const searchQuery: string | undefined = parameters.query?.q;

    // Async readdir — a missing database dir is just an empty list.
    let entries: import('node:fs').Dirent[];
    try {
        entries = await fs.readdir(databaseDir, { withFileTypes: true });
    } catch {
        return { status: 200, response: { workflows: [] } };
    }

    // Read every meta.json CONCURRENTLY — the dashboard polls this endpoint
    // while generations run, and sequential sync reads used to serialize the
    // whole scan into the event loop on every poll.
    const metas = await Promise.all(
        entries.filter((e) => e.isDirectory()).map((e) => readMeta(databaseDir, e.name))
    );

    const workflows: WorkflowMeta[] = [];
    const q = searchQuery?.trim().toLowerCase();
    for (const meta of metas) {
        if (!meta) continue; // no meta.json / corrupted folder
        if (q) {
            const nameMatch = meta.name.toLowerCase().includes(q);
            const descMatch = (meta.description ?? '').toLowerCase().includes(q);
            const tagMatch = (meta.tags ?? []).some((t) => t.toLowerCase().includes(q));
            if (!nameMatch && !descMatch && !tagMatch) continue;
        }
        workflows.push(meta);
    }

    workflows.sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));

    return { status: 200, response: { workflows } };
});
