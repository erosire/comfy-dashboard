// API client for the ComfyUI dashboard endpoints.
//
// Routes (see src/server/endpoints/comfy-dashboard.yml):
//
// Workflow collection:
//   GET /api/workflows          → { workflows: WorkflowMeta[] }
//
// Workflow detail:
//   GET /api/workflows/:id      → { workflow: Workflow }
//   POST /api/workflows         → { workflow: WorkflowMeta }
//   DELETE /api/workflows/:id   → { success: boolean, id: string }
//
// Queue:
//   GET /api/queue              → { queue: QueueItem[] }
//   POST /api/queue             → { id: string, message: string }
//   DELETE /api/queue/:id       → { success: boolean }
//
// Status:
//   GET /api/status             → { status: ServerStatus }

// ── Types ──────────────────────────────────────────────────────────────

export type WorkflowMeta = {
    id: string;
    name: string;
    description?: string;
    nodeCount: number;
    createdDate: string;
    modifiedDate: string;
    tags?: string[];
};

export type WorkflowNode = {
    id: string;
    type: string;
    position: { x: number; y: number };
    inputs: Record<string, unknown>;
};

export type Workflow = WorkflowMeta & {
    nodes: WorkflowNode[];
    raw: Record<string, unknown>; // the raw ComfyUI workflow JSON
};

export type QueueItem = {
    id: string;
    workflowId: string;
    workflowName: string;
    status: 'queued' | 'running' | 'completed' | 'failed';
    queuedAt: string;
    startedAt?: string;
    completedAt?: string;
    error?: string;
};

export type ServerStatus = {
    connected: boolean;
    queueSize: number;
    activeJobs: number;
    uptime: number;
    version?: string;
};

// ── API Functions ──────────────────────────────────────────────────────

// Fetch the list of all workflows.
export async function fetchWorkflows(baseUrl: string): Promise<{ workflows: WorkflowMeta[] }> {
    const response = await fetch(baseUrl);
    if (!response.ok) {
        let message = `Failed to list workflows (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    const data = await response.json() as { workflows: WorkflowMeta[] };
    return { workflows: Array.isArray(data.workflows) ? data.workflows : [] };
}

// Fetch a single workflow by ID.
export async function fetchWorkflow(baseUrl: string, id: string): Promise<{ workflow: Workflow }> {
    const url = `${baseUrl}/${encodeURIComponent(id)}`;
    const response = await fetch(url);
    if (!response.ok) {
        let message = `Failed to fetch workflow (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { workflow: Workflow };
}

// Create (upload) a new workflow.
export async function createWorkflow(
    baseUrl: string,
    body: { name: string; description?: string; raw: Record<string, unknown> }
): Promise<{ workflow: WorkflowMeta }> {
    const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        let message = `Failed to create workflow (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { workflow: WorkflowMeta };
}

// Delete a workflow.
export async function deleteWorkflow(
    baseUrl: string,
    id: string
): Promise<{ success: boolean; id: string }> {
    const url = `${baseUrl}/${encodeURIComponent(id)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
        let message = `Failed to delete workflow (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { success: boolean; id: string };
}

// Fetch the current queue.
export async function fetchQueue(baseUrl: string): Promise<{ queue: QueueItem[] }> {
    const response = await fetch(baseUrl);
    if (!response.ok) {
        let message = `Failed to fetch queue (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    const data = await response.json() as { queue: QueueItem[] };
    return { queue: Array.isArray(data.queue) ? data.queue : [] };
}

// Queue a workflow for generation.
export async function queueWorkflow(
    baseUrl: string,
    body: { workflowId: string; params?: Record<string, unknown> }
): Promise<{ id: string; message: string }> {
    const response = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        let message = `Failed to queue workflow (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { id: string; message: string };
}

// Cancel a queue item.
export async function cancelQueueItem(
    baseUrl: string,
    id: string
): Promise<{ success: boolean }> {
    const url = `${baseUrl}/${encodeURIComponent(id)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
        let message = `Failed to cancel queue item (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { success: boolean };
}

// Fetch server status.
export async function fetchStatus(baseUrl: string): Promise<ServerStatus> {
    const response = await fetch(baseUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch status (HTTP ${response.status})`);
    }
    return (await response.json()) as ServerStatus;
}

// Poll a URL at intervals until a stop condition is met.
export type PollFinalResult<T> =
    | { status: 'data'; data: T }
    | { status: 'error'; error: string }
    | { status: 'stopped' };

export async function pollLoop<T>(params: {
    fetch: () => Promise<T>;
    pollIntervalMs: number;
    shouldStop: () => boolean;
    onData: (data: T) => void;
}): Promise<PollFinalResult<T>> {
    const { fetch: fetchData, pollIntervalMs, shouldStop, onData } = params;

    while (true) {
        if (shouldStop()) return { status: 'stopped' };

        try {
            const data = await fetchData();
            onData(data);
        } catch (err) {
            return { status: 'error', error: String(err) };
        }

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
}
