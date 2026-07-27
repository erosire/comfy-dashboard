// Workflow create endpoint — POST /api/workflows
//
// Creates a new workflow entry. Stores the workflow JSON in the database
// directory. Extracts node count from the raw workflow JSON.

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowCreate = asHandlerMethod(async (request, _, variables) => {
    const projectRoot = variables.root;
    const body = request.body as { name?: string; description?: string; raw?: Record<string, unknown> } | undefined;

    if (!body?.name) {
        return { status: 400, response: { error: 'name is required' } };
    }

    if (!body?.raw) {
        return { status: 400, response: { error: 'raw workflow JSON is required' } };
    }

    // Generate a simple ID from the name + timestamp
    const id = `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // Count nodes from the raw workflow (ComfyUI format has a `nodes` array or top-level keys)
    const rawNodes = (body.raw as any).nodes;
    const nodeCount = Array.isArray(rawNodes) ? rawNodes.length : 0;

    // Extract tags from node types
    const tags: string[] = [];
    if (Array.isArray(rawNodes)) {
        const types = new Set<string>();
        for (const node of rawNodes) {
            if (node.type) types.add(String(node.type).toLowerCase());
        }
        // Include first few unique node types as tags (cap at 5)
        let i = 0;
        for (const t of types) {
            if (i >= 5) break;
            tags.push(t);
            i++;
        }
    }

    const workflow = {
        id,
        name: body.name,
        description: body.description,
        nodeCount,
        createdDate: now,
        modifiedDate: now,
        tags,
        nodes: rawNodes ?? [],
        raw: body.raw
    };

    const databaseDir = path.join(projectRoot, 'temporary/database/comfy-workflows');
    fs.mkdirSync(databaseDir, { recursive: true });

    const filePath = path.join(databaseDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2), 'utf-8');

    return {
        status: 200,
        response: {
            workflow: {
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
                nodeCount: workflow.nodeCount,
                createdDate: workflow.createdDate,
                modifiedDate: workflow.modifiedDate,
                tags: workflow.tags
            }
        }
    };
});
