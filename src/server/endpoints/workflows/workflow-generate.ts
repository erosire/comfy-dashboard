// Workflow generate endpoint — POST /v1/comfy/workflows/:id/generate
//
// Creates a generation snapshot of the workflow's current workflow.json.
// Stores it in a "generation" subfolder inside the workflow's directory:
//
//   YYYYMMDD-HHMMSS/
//     ├── workflow.json
//     ├── meta.json
//     └── generation/
//           └── YYYYMMDD-HHMMSS.json   ← this file

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowGenerate = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    const workflowDir = path.join(projectRoot, 'temporary/database/comfy-workflows', workflowId);
    const workflowJsonPath = path.join(workflowDir, 'workflow.json');

    if (!fs.existsSync(workflowJsonPath)) {
        return { status: 404, response: { error: `Workflow '${workflowId}' not found` } };
    }

    // Read the workflow.json
    let workflowData: Record<string, unknown>;
    try {
        workflowData = JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));
    } catch {
        return { status: 500, response: { error: 'Failed to read workflow.json' } };
    }

    // Generate timestamped filename
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timestamp =
        now.getFullYear().toString() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        '-' +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds());

    // Ensure the generation subfolder exists
    const generationDir = path.join(workflowDir, 'generation');
    fs.mkdirSync(generationDir, { recursive: true });

    // Handle filename collision with a counter suffix
    let filename = `${timestamp}.json`;
    let filePath = path.join(generationDir, filename);
    let counter = 1;
    while (fs.existsSync(filePath)) {
        filename = `${timestamp}-${String(counter).padStart(2, '0')}.json`;
        filePath = path.join(generationDir, filename);
        counter++;
    }

    // Write the generation file
    fs.writeFileSync(filePath, JSON.stringify(workflowData, null, 2), 'utf-8');

    return {
        status: 200,
        response: {
            generated: filename
        }
    };
});
