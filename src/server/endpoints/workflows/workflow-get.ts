// Workflow detail endpoint — GET /v1/comfy/workflows/:id
//
// Returns the full workflow including nodes, raw JSON, and metadata.
//
// Folder format:
//   YYYYMMDD-HHMMSS/
//     ├── workflow.json   (ComfyUI-compatible workflow JSON)
//     └── meta.json       (dashboard metadata)

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowGet = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    const baseDir = path.join(projectRoot, 'temporary/database/comfy-workflows');
    const metaPath = path.join(baseDir, workflowId, 'meta.json');
    const workflowJsonPath = path.join(baseDir, workflowId, 'workflow.json');

    if (!fs.existsSync(metaPath) || !fs.existsSync(workflowJsonPath)) {
        return { status: 404, response: { error: `Workflow '${workflowId}' not found` } };
    }

    try {
        const metaData = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        const workflowData = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));

        return {
            status: 200,
            response: {
                workflow: {
                    id: metaData.id ?? workflowId,
                    name: metaData.name ?? 'Untitled Workflow',
                    description: metaData.description,
                    nodeCount: metaData.nodeCount ?? 0,
                    createdDate: metaData.createdDate ?? '',
                    modifiedDate: metaData.modifiedDate ?? '',
                    tags: metaData.tags ?? [],
                    inputFields: Array.isArray(metaData.inputFields) ? metaData.inputFields : [],
                    raw: workflowData
                }
            }
        };
    } catch {
        return { status: 500, response: { error: 'Failed to read workflow data' } };
    }
});
