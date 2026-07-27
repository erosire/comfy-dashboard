// Workflow detail endpoint — GET /v1/comfy/workflows/:id
//
// Returns the full workflow including nodes and raw JSON.

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowGet = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    const filePath = path.join(
        projectRoot,
        'temporary/database/comfy-workflows',
        `${workflowId}.json`
    );

    if (!fs.existsSync(filePath)) {
        return { status: 404, response: { error: `Workflow '${workflowId}' not found` } };
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw);
        return { status: 200, response: { workflow: data } };
    } catch {
        return { status: 500, response: { error: 'Failed to read workflow data' } };
    }
});
