// Workflow create endpoint — POST /v1/comfy/workflows
//
// Creates a new workflow entry. Stores the workflow JSON in the database
// directory. Extracts node count from the raw workflow JSON.

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowCreate = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const body = parameters.body as { name?: string; description?: string; raw?: Record<string, unknown> } | undefined;

    if (!body?.name) {
        return { status: 400, response: { error: 'name is required' } };
    }

    if (!body?.raw) {
        return { status: 400, response: { error: 'raw workflow JSON is required' } };
    }

    // Generate a simple ID from the name + timestamp
    const id = `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    // Count nodes from the raw workflow (handles multiple ComfyUI formats)
    let nodeCount = 0;
    const rawNodes = (body.raw as any).nodes;
    if (Array.isArray(rawNodes)) {
        // UI format: { "nodes": [...] }
        nodeCount = rawNodes.length;
    } else {
        // API format: { "3": { class_type, inputs }, ... } or prompt wrapper
        const promptObj = (body.raw as any).prompt ?? body.raw;
        if (typeof promptObj === 'object' && promptObj !== null) {
            nodeCount = Object.keys(promptObj).filter(
                (k) => {
                    const v = promptObj[k];
                    return v && typeof v === 'object' && 'class_type' in v;
                }
            ).length;
        }
    }

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
    } else {
        // API format: extract class_types
        const promptObj = (body.raw as any).prompt ?? body.raw;
        if (typeof promptObj === 'object' && promptObj !== null) {
            const types = new Set<string>();
            for (const [, value] of Object.entries(promptObj)) {
                const node = value as Record<string, unknown>;
                if (node && typeof node === 'object' && 'class_type' in node) {
                    types.add(String(node.class_type).toLowerCase());
                }
            }
            let i = 0;
            for (const t of types) {
                if (i >= 5) break;
                tags.push(t);
                i++;
            }
        }
    }

    // Build nodes list for storage (normalize from raw)
    let storedNodes: unknown[] = [];
    if (Array.isArray(rawNodes)) {
        storedNodes = rawNodes;
    } else {
        const promptObj = (body.raw as any).prompt ?? body.raw;
        if (typeof promptObj === 'object' && promptObj !== null) {
            storedNodes = Object.entries(promptObj)
                .filter(([, v]) => v && typeof v === 'object' && 'class_type' in (v as Record<string, unknown>))
                .map(([id, v]) => ({ id, ...(v as Record<string, unknown>) }));
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
        nodes: storedNodes,
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
