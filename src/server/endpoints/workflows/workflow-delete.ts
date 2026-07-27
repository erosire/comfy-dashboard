// Workflow delete endpoint — DELETE /v1/comfy/workflows/:id
//
// Permanently removes a workflow file from the database directory.

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowDelete = asHandlerMethod(async (_, parameters, variables) => {
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
        fs.unlinkSync(filePath);
        return { status: 200, response: { success: true, id: workflowId } };
    } catch {
        return { status: 500, response: { error: 'Failed to delete workflow' } };
    }
});
