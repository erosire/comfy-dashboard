// Workflow list endpoint — GET /api/workflows
//
// Returns all stored workflows from the local workflow database directory.
// Each entry is a JSON file under temporary/database/comfy-workflows/.
// Sorted by modifiedDate descending (newest first).

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

export const workflowList = asHandlerMethod(async (_, __, variables) => {
    const projectRoot = variables.root;
    const databaseDir = path.join(projectRoot, 'temporary/database/comfy-workflows');

    if (!fs.existsSync(databaseDir)) {
        return { status: 200, response: { workflows: [] } };
    }

    const entries = fs.readdirSync(databaseDir, { withFileTypes: true });
    const workflows: WorkflowMeta[] = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

        try {
            const raw = fs.readFileSync(path.join(databaseDir, entry.name), 'utf-8');
            const data = JSON.parse(raw);

            workflows.push({
                id: data.id ?? entry.name.replace('.json', ''),
                name: data.name ?? 'Untitled Workflow',
                description: data.description,
                nodeCount: typeof data.nodeCount === 'number' ? data.nodeCount : 0,
                createdDate: data.createdDate ?? '',
                modifiedDate: data.modifiedDate ?? '',
                tags: Array.isArray(data.tags) ? data.tags : []
            });
        } catch {
            // Skip corrupted files
        }
    }

    workflows.sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));

    return { status: 200, response: { workflows } };
});
