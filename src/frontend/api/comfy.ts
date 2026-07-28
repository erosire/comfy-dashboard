// API client for the ComfyUI dashboard endpoints.
//
// Routes (see src/server/endpoints/comfy-dashboard.yml):
//
// Workflow collection:
//   GET    /v1/comfy/workflows       → { workflows: WorkflowMeta[] }
//   POST   /v1/comfy/workflows       → { workflow: WorkflowMeta }
//
// Workflow detail:
//   GET    /v1/comfy/workflows/:id   → { workflow: Workflow }
//   PATCH  /v1/comfy/workflows/:id   → { workflow: Workflow }
//   DELETE /v1/comfy/workflows/:id   → { success: boolean, id: string }
//
// Queue:
//   GET /v1/comfy/queue              → { queue: QueueItem[] }
//   POST /v1/comfy/queue             → { id: string, message: string }
//   DELETE /v1/comfy/queue/:id       → { success: boolean }
//
// Status:
//   GET /v1/comfy/status             → { status: ServerStatus }

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

export type GenerationEntry = {
    id: string;
    status: 'pending' | 'completed' | 'failed';
    createdDate: string;
    completedDate: string | null;
    error: string | null;
    prompt: Record<string, unknown>;
};

// ── API Functions ──────────────────────────────────────────────────────

// Fetch the list of all workflows, optionally filtered by search query.
export async function fetchWorkflows(
    baseUrl: string,
    options?: { query?: string }
): Promise<{ workflows: WorkflowMeta[] }> {
    let url = baseUrl;
    if (options?.query && options.query.trim()) {
        const params = new URLSearchParams({ q: options.query });
        url = `${baseUrl}?${params.toString()}`;
    }
    const response = await fetch(url);
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

// Update (patch) an existing workflow.
export async function updateWorkflow(
    baseUrl: string,
    id: string,
    body: { name?: string; description?: string; raw?: Record<string, unknown>; tags?: string[] }
): Promise<{ workflow: Workflow }> {
    const url = `${baseUrl}/${encodeURIComponent(id)}`;
    const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        let message = `Failed to update workflow (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { workflow: Workflow };
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

// Generate a workflow — creates a generation file on the server.
export async function generateWorkflow(
    baseUrl: string,
    workflowId: string
): Promise<{ generation: GenerationEntry }> {
    const url = `${baseUrl}/workflows/${encodeURIComponent(workflowId)}/generate`;
    const response = await fetch(url, { method: 'POST' });
    if (!response.ok) {
        let message = `Failed to generate workflow (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { generation: GenerationEntry };
}

// Fetch all generations for a workflow.
export async function fetchGenerations(
    baseUrl: string,
    workflowId: string
): Promise<{ generations: GenerationEntry[] }> {
    const url = `${baseUrl}/workflows/${encodeURIComponent(workflowId)}/generate`;
    const response = await fetch(url);
    if (!response.ok) {
        let message = `Failed to fetch generations (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    const data = (await response.json()) as { generations: GenerationEntry[] };
    return { generations: Array.isArray(data.generations) ? data.generations : [] };
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
