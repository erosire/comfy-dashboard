// Cloud queue list endpoint — GET /v1/comfy/cloud/prompt
//
// Returns all queued prompts from the server-side queue directory.
// Each entry is a JSON file under temporary/database/comfy-cloud-queue/.
// Sorted by submittedAt descending (newest first).

import fs from 'node:fs';
import path from 'node:path';
import { asHandlerMethod } from '@underload/service';

type CloudQueueItem = {
    prompt_id: string;
    pod_url: string | null;
    workflowId: string | null;
    workflowName: string | null;
    nodeCount: number;
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    submittedAt: string;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
};

export const cloudQueueList = asHandlerMethod(async (_request, _parameters, variables) => {
    const projectRoot = variables.root;
    const databaseDir = path.join(projectRoot, 'temporary/database/comfy-cloud-queue');

    if (!fs.existsSync(databaseDir)) {
        return { status: 200, response: { queue: [] } };
    }

    const entries = fs.readdirSync(databaseDir, { withFileTypes: true });
    const queue: CloudQueueItem[] = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;

        try {
            const raw = fs.readFileSync(path.join(databaseDir, entry.name), 'utf-8');
            const data = JSON.parse(raw);

            // Skip entries that are completed or cancelled (old entries)
            // but include queued, processing, and failed ones
            const item: CloudQueueItem = {
                prompt_id: data.prompt_id ?? entry.name.replace('.json', ''),
                pod_url: data.pod_url ?? null,
                workflowId: data.workflowId ?? null,
                workflowName: data.workflowName ?? null,
                nodeCount: typeof data.nodeCount === 'number' ? data.nodeCount : 0,
                status: data.status ?? 'queued',
                submittedAt: data.submittedAt ?? '',
                startedAt: data.startedAt ?? null,
                completedAt: data.completedAt ?? null,
                error: data.error ?? null
            };

            queue.push(item);
        } catch {
            // Skip corrupted files
        }
    }

    // Sort by submittedAt descending (newest first)
    queue.sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));

    return { status: 200, response: { queue } };
});
