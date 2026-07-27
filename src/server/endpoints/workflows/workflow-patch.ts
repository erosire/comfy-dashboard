// Workflow update endpoint — PATCH /v1/comfy/workflows/:id
//
// Partially updates an existing workflow. Accepts any combination of
// name, description, raw workflow JSON, and tags. Only provided fields
// are updated; omitted fields retain their current values.

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const workflowPatch = asHandlerMethod(async (request, parameters, variables) => {
    const projectRoot = variables.root;
    const workflowId = parameters.path.id;
    const body = request.body as {
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
            existing.nodes = Array.isArray(rawNodes) ? rawNodes : [];
            existing.nodeCount = Array.isArray(rawNodes) ? rawNodes.length : 0;

            // Re-extract tags from node types if tags weren't explicitly provided
            if (body.tags === undefined && Array.isArray(rawNodes)) {
                const types = new Set<string>();
                for (const node of rawNodes) {
                    if (node.type) types.add(String(node.type).toLowerCase());
                }
                const newTags: string[] = [];
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
