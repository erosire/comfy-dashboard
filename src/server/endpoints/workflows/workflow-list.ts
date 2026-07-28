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

import fs from 'node:fs';
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
};

export const workflowList = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const databaseDir = path.join(projectRoot, 'temporary/database/comfy-workflows');
    const searchQuery: string | undefined = parameters.query?.q;

    if (!fs.existsSync(databaseDir)) {
        return { status: 200, response: { workflows: [] } };
    }

    const entries = fs.readdirSync(databaseDir, { withFileTypes: true });
    const workflows: WorkflowMeta[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const metaPath = path.join(databaseDir, entry.name, 'meta.json');
        if (!fs.existsSync(metaPath)) continue;

        try {
            const raw = fs.readFileSync(metaPath, 'utf-8');
            const data = JSON.parse(raw);
            const meta: WorkflowMeta = {
                id: data.id ?? entry.name,
                name: data.name ?? 'Untitled Workflow',
                description: data.description,
                nodeCount: typeof data.nodeCount === 'number' ? data.nodeCount : 0,
                createdDate: data.createdDate ?? '',
                modifiedDate: data.modifiedDate ?? '',
                tags: Array.isArray(data.tags) ? data.tags : []
            };

            if (searchQuery && searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const nameMatch = meta.name.toLowerCase().includes(q);
                const descMatch = (meta.description ?? '').toLowerCase().includes(q);
                const tagMatch = (meta.tags ?? []).some((t) => t.toLowerCase().includes(q));
                if (!nameMatch && !descMatch && !tagMatch) continue;
            }

            workflows.push(meta);
        } catch {
            // Skip corrupted folders
        }
    }

    workflows.sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));

    return { status: 200, response: { workflows } };
});
