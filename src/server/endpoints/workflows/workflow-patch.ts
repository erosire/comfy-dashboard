// Workflow update endpoint — PATCH /v1/comfy/workflows/:id
//
// Partially updates an existing workflow. Accepts any combination of
// name, description, raw workflow JSON, and tags. Only provided fields
// are updated; omitted fields retain their current values.
//
// Folder format:
//   YYYYMMDD-HHMMSS/
//     ├── workflow.json   (ComfyUI-compatible workflow JSON)
//     └── meta.json       (dashboard metadata)

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

/** Count nodes from raw workflow data (handles multiple ComfyUI formats). */
function countNodes(raw: Record<string, unknown>): number {
    const rawNodes = (raw as any).nodes;
    if (Array.isArray(rawNodes)) {
        return rawNodes.length;
    }
    const promptObj = (raw as any).prompt ?? raw;
    if (typeof promptObj === 'object' && promptObj !== null) {
        return Object.keys(promptObj).filter((k) => {
            const v = promptObj[k];
            return v && typeof v === 'object' && 'class_type' in v;
        }).length;
    }
    return 0;
}

/** Extract tags from node types in raw workflow data. */
function extractTags(raw: Record<string, unknown>): string[] {
    const rawNodes = (raw as any).nodes;
    const types = new Set<string>();

    if (Array.isArray(rawNodes)) {
        for (const node of rawNodes) {
            if (node.type) types.add(String(node.type).toLowerCase());
        }
    } else {
        const promptObj = (raw as any).prompt ?? raw;
        if (typeof promptObj === 'object' && promptObj !== null) {
            for (const [, value] of Object.entries(promptObj)) {
                const node = value as Record<string, unknown>;
                if (node && typeof node === 'object' && 'class_type' in node) {
                    types.add(String(node.class_type).toLowerCase());
                }
            }
        }
    }

    const tags: string[] = [];
    let i = 0;
    for (const t of types) {
        if (i >= 5) break;
        tags.push(t);
        i++;
    }
    return tags;
}

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

    const baseDir = path.join(projectRoot, 'temporary/database/comfy-workflows');
    const metaPath = path.join(baseDir, workflowId, 'meta.json');
    const workflowJsonPath = path.join(baseDir, workflowId, 'workflow.json');

    if (!fs.existsSync(metaPath) || !fs.existsSync(workflowJsonPath)) {
        return { status: 404, response: { error: `Workflow '${workflowId}' not found` } };
    }

    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

        if (body.name !== undefined) meta.name = body.name;
        if (body.description !== undefined) meta.description = body.description;
        if (body.tags !== undefined) {
            meta.tags = body.tags;
        } else if (body.raw !== undefined) {
            meta.tags = extractTags(body.raw);
        }

        if (body.raw !== undefined) {
            meta.nodeCount = countNodes(body.raw);
        }

        meta.modifiedDate = new Date().toISOString();

        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

        if (body.raw !== undefined) {
            fs.writeFileSync(workflowJsonPath, JSON.stringify(body.raw, null, 2), 'utf-8');
        }

        const raw = body.raw ?? JSON.parse(fs.readFileSync(workflowJsonPath, 'utf-8'));

        return {
            status: 200,
            response: {
                workflow: {
                    id: meta.id ?? workflowId,
                    name: meta.name,
                    description: meta.description,
                    nodeCount: meta.nodeCount,
                    createdDate: meta.createdDate,
                    modifiedDate: meta.modifiedDate,
                    tags: meta.tags,
                    raw
                }
            }
        };
    } catch {
        return { status: 500, response: { error: 'Failed to update workflow' } };
    }
});
