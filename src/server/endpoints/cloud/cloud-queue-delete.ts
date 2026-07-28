// Cloud queue delete endpoint — DELETE /v1/comfy/cloud/prompt/:promptId
//
// Removes a queued prompt from the server-side queue directory.

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const cloudQueueDelete = asHandlerMethod(async (_request, parameters, variables) => {
    const projectRoot = variables.root;
    const promptId = parameters.path.promptId;

    if (!promptId) {
        return { status: 400, response: { error: 'promptId is required' } };
    }

    const filePath = path.join(
        projectRoot,
        'temporary/database/comfy-cloud-queue',
        `${promptId}.json`
    );

    if (!fs.existsSync(filePath)) {
        return { status: 404, response: { error: `Prompt '${promptId}' not found in queue` } };
    }

    try {
        fs.unlinkSync(filePath);
        return { status: 200, response: { success: true, prompt_id: promptId } };
    } catch {
        return { status: 500, response: { error: 'Failed to delete prompt from queue' } };
    }
});
