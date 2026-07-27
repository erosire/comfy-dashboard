// Workflow update endpoint — PATCH /v1/comfy/workflows/:id
//
// Partially updates an existing workflow. Accepts any combination of
// name, description, raw workflow JSON, and tags. Only provided fields
// are updated; omitted fields retain their current values.

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowPatch = asHandlerMethod(async (_, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;
    const body = parameters.body as {
        name?: string;
        description?: string;
        raw?: Record<string, unknown>;
        tags?: string[];
    } | undefined;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }

    if (!body || Object.keys(body).length === 0) {
        return { status: 400, response: { error: 'At least one field (name, description, raw, tags) must be provided' } };
    }

    const databaseDir = path.join(projectRoot, 'temporary/database/comfy-workflows');
    const filePath = path.join(databaseDir, `${workflowId}.json`);

    if (!fs.existsSync(filePath)) {
        return { status: 404, response: { error: `Workflow '${workflowId}' not found` } };
    }

    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const existing = JSON.parse(raw);

        // Merge partial updates
        if (body.name !== undefined) existing.name = body.name;
        if (body.description !== undefined) existing.description = body.description;
        if (body.tags !== undefined) existing.tags = body.tags;

        // If raw workflow JSON is updated, re-extract nodes and nodeCount
        if (body.raw !== undefined) {
            existing.raw = body.raw;

            const rawNodes = (body.raw as any).nodes;
            let nodeCount = 0;
            let storedNodes: unknown[] = [];
            const newTags: string[] = [];

            if (Array.isArray(rawNodes)) {
                // UI format: { "nodes": [...] }
                nodeCount = rawNodes.length;
                storedNodes = rawNodes;
            } else {
                // API format: { "3": { class_type, inputs }, ... } or prompt wrapper
                const promptObj = (body.raw as any).prompt ?? body.raw;
                if (typeof promptObj === 'object' && promptObj !== null) {
                    const entries = Object.entries(promptObj).filter(
                        ([, v]) => v && typeof v === 'object' && 'class_type' in (v as Record<string, unknown>)
                    );
                    nodeCount = entries.length;
                    storedNodes = entries.map(([id, v]) => ({ id, ...(v as Record<string, unknown>) }));
                }
            }

            existing.nodes = storedNodes;
            existing.nodeCount = nodeCount;

            // Re-extract tags from node types if tags weren't explicitly provided
            if (body.tags === undefined) {
                const types = new Set<string>();
                if (Array.isArray(rawNodes)) {
                    for (const node of rawNodes) {
                        if (node.type) types.add(String(node.type).toLowerCase());
                    }
                } else {
                    const promptObj = (body.raw as any).prompt ?? body.raw;
                    if (typeof promptObj === 'object' && promptObj !== null) {
                        for (const [, value] of Object.entries(promptObj)) {
                            const node = value as Record<string, unknown>;
                            if (node && typeof node === 'object' && 'class_type' in node) {
                                types.add(String(node.class_type).toLowerCase());
                            }
                        }
                    }
                }
                let i = 0;
                for (const t of types) {
                    if (i >= 5) break;
                    newTags.push(t);
                    i++;
                }
                existing.tags = newTags;
            }
        }

        existing.modifiedDate = new Date().toISOString();

        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');

        return {
            status: 200,
            response: {
                workflow: {
                    id: existing.id,
                    name: existing.name,
                    description: existing.description,
                    nodeCount: existing.nodeCount,
                    createdDate: existing.createdDate,
                    modifiedDate: existing.modifiedDate,
                    tags: existing.tags,
                    nodes: existing.nodes,
                    raw: existing.raw
                }
            }
        };
    } catch {
        return { status: 500, response: { error: 'Failed to update workflow' } };
    }
});
