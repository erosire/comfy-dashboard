// Workflow delete endpoint — DELETE /v1/comfy/workflows/:id
//
// Permanently removes a workflow folder from the database directory.
//
// Folder format:
//   YYYYMMDD-HHMMSS/   (recursively deleted)

import fs from 'node:fs/promises';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowDelete = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    // Resolve below the shared database root; the distribution owns this
    // comfy-workflows namespace.
    const folderPath = path.join(projectRoot, 'comfy-workflows', workflowId);

    try {
        const stats = await fs.stat(folderPath);
        if (!stats.isDirectory()) throw new Error('not a directory');
    } catch {
        return { status: 404, response: { error: `Workflow '${workflowId}' not found` } };
    }

    try {
        await fs.rm(folderPath, { recursive: true, force: true });
        return { status: 200, response: { success: true, id: workflowId } };
    } catch {
        return { status: 500, response: { error: 'Failed to delete workflow folder' } };
    }
});
