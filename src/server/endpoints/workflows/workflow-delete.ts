// Workflow delete endpoint — DELETE /v1/comfy/workflows/:id
//
// Permanently removes a workflow folder from the database directory.
//
// Folder format:
//   YYYYMMDD-HHMMSS/   (recursively deleted)

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowDelete = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    const folderPath = path.join(projectRoot, 'temporary/database/comfy-workflows', workflowId);

    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
        return { status: 404, response: { error: `Workflow '${workflowId}' not found` } };
    }

    try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        return { status: 200, response: { success: true, id: workflowId } };
    } catch {
        return { status: 500, response: { error: 'Failed to delete workflow folder' } };
    }
});
