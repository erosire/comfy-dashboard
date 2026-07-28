// Cloud queue submit endpoint — POST /v1/comfy/cloud/prompt
//
// Stores a prompt in the server-side queue for later processing.
// Returns a prompt_id that can be used to track, list, or delete the prompt.
//
// The stored record contains enough information for server-side processing:
//   - prompt_id: unique identifier
//   - pod_url: the target pod URL (if known at submit time)
//   - prompt: the ComfyUI workflow graph object
//   - client_id: optional client identifier
//   - extra_data: optional extra data for ComfyUI
//   - workflowId / workflowName: optional workflow metadata
//   - status: queued | processing | completed | failed | cancelled
//   - timestamps: submittedAt, startedAt, completedAt

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

export const cloudQueueSubmit = asHandlerMethod(async (_request, parameters, variables) => {
    const projectRoot = variables.root;
    const body = parameters.body as {
        pod_url?: string;
        prompt?: Record<string, unknown>;
        client_id?: string;
        extra_data?: Record<string, unknown>;
        front?: boolean;
        number?: number;
        workflowId?: string;
        workflowName?: string;
        nodeCount?: number;
    } | undefined;

    if (!body?.prompt || typeof body.prompt !== 'object') {
        return { status: 400, response: { error: 'prompt object is required' } };
    }

    // Validate pod_url if provided
    if (body.pod_url) {
        try {
            new URL(body.pod_url);
        } catch {
            return { status: 400, response: { error: `Invalid pod_url: ${body.pod_url}` } };
        }
    }

    // Generate prompt_id
    const promptId = `qp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    // Build the queue entry with enough information for server-side processing
    const queueEntry = {
        prompt_id: promptId,
        pod_url: body.pod_url ?? null,
        prompt: body.prompt,
        client_id: body.client_id ?? null,
        extra_data: body.extra_data ?? null,
        front: body.front ?? false,
        number: body.number ?? null,
        workflowId: body.workflowId ?? null,
        workflowName: body.workflowName ?? null,
        nodeCount: body.nodeCount ?? 0,
        status: 'queued' as const,
        submittedAt: now,
        startedAt: null,
        completedAt: null,
        error: null
    };

    // Persist to database directory
    const databaseDir = path.join(projectRoot, 'temporary/database/comfy-cloud-queue');
    fs.mkdirSync(databaseDir, { recursive: true });

    const filePath = path.join(databaseDir, `${promptId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(queueEntry, null, 2), 'utf-8');

    return {
        status: 200,
        response: { prompt_id: promptId }
    };
});
