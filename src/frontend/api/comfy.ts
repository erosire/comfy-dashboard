// API client for the ComfyUI dashboard endpoints.
//
// Routes (see src/server/endpoints/comfy-dashboard.yaml):
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
// Generations (lightweight list + full single-entry fetch):
//   GET    /v1/comfy/workflows/:id/generate                → { generations: GenerationSummary[] }
//   POST   /v1/comfy/workflows/:id/generate                → { generation: GenerationEntry }
//   GET    /v1/comfy/workflows/:id/generate/:generate_id   → { generation: GenerationEntry }
//   PUT    /v1/comfy/workflows/:id/generate/:generate_id   → { generation: GenerationEntry }
//   DELETE /v1/comfy/workflows/:id/generate/:generate_id   → { success: boolean, id: string }
//
// Generation result media (streamable binary — <img src> / <video src> ready):
//   GET    /v1/comfy/workflows/:id/generate/:generate_id/result/:index → raw bytes (image/*, video/*)
//
// Generation log (the run's timestamped event trail, for debugging):
//   GET    /v1/comfy/workflows/:id/generate/:generate_id/log           → { log: string }
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
    /**
     * Widget keys ("<nodeId>:<inputName>") marked as workflow Inputs in
     * the PROMPT tab (persisted in the workflow json as extra.inputFields
     * and mirrored into meta.json). Workflows with Inputs appear in the
     * result viewer's preview dropdown — picking one feeds the viewed
     * image's base64 data stream into the marked fields and runs it.
     */
    inputFields?: string[];
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

export type GenerationResultItem = {
    type: 'image' | 'video' | 'audio';
    url: string;
    mimeType: string;
    size: number;
    nodeId: string;
};

/**
 * A result item WITHOUT its heavy `url` payload — what GenerationSummary
 * entries carry so the UI can label/count results (and pick <img> vs
 * <video>) without pulling megabytes of base64. The bytes themselves are
 * streamed on demand via `generationResultUrl()`.
 */
export type GenerationResultMeta = Omit<GenerationResultItem, 'url'>;

// NOTE: the raw NDJSON event stream of a run is intentionally NOT part of
// the entry — the server writes a timestamped .log file next to the
// generation json with the full chronological trail (a line per status
// change and per streamed event). Keeping transient event megabytes out of
// the json keeps it small and quick to read/write.
export type GenerationEntry = {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdDate: string;
    completedDate: string | null;
    generatedTime: string | null;
    error: string | null;
    /**
     * The ORIGINAL workflow json snapshot (v0.4/v1 editor format — the
     * lossless document). The server converts it to the flat API prompt
     * when submitting to a Comfy Cloud pod, so it also doubles as the
     * verbatim copy source for "create a workflow from this generation".
     */
    prompt: Record<string, unknown>;
    result: GenerationResultItem[];
};

/**
 * Lightweight summary of a generation entry — what the list endpoint
 * (GET /v1/comfy/workflows/{id}/generate) returns.
 *
* Excludes the heavy `prompt` (full workflow JSON) and `result` payloads
* (image/video data: URLs, often megabytes) so the list loads fast.
* `resultItems` carries the per-result display metadata (no payloads), and
* `resultCount` lets the UI render "N items" — previews stream straight from
* `generationResultUrl()` without fetching the full entry. The full entry
* (prompt, result) is still available with `fetchGeneration` when actually
* needed. (The raw NDJSON event trail is intentionally NOT part of the entry
* — the server stores it in a sidecar .log file.)
 */
export type GenerationSummary = {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdDate: string;
    completedDate: string | null;
    generatedTime: string | null;
    error: string | null;
    /** Number of result items (images/videos) in the full entry. */
    resultCount: number;
    /** Per-result display metadata — everything except the heavy url payload. */
    resultItems: GenerationResultMeta[];
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
// When `prompt` is provided it is snapshotted instead of the stored
// workflow.json — the UI passes its serialized ORIGINAL workflow json
// (v0.4/v1 editor format with every edit), so the generation captures
// exactly the document visible at click time, lossless. The server
// converts it to the flat API prompt when submitting to a pod.
// When `name` is provided it names the generation (the server uses it as
// the generation id after sanitizing it to a safe file base name); when
// omitted, the server falls back to its timestamped default.
export async function generateWorkflow(
    baseUrl: string,
    workflowId: string,
    prompt?: Record<string, unknown>,
    name?: string
): Promise<{ generation: GenerationEntry }> {
    const url = `${baseUrl}/workflows/${encodeURIComponent(workflowId)}/generate`;
    // Only attach a JSON body when at least one optional field is provided.
    const payload: { prompt?: Record<string, unknown>; name?: string } = {};
    if (prompt) payload.prompt = prompt;
    if (name) payload.name = name;
    const response = await fetch(
        url,
        Object.keys(payload).length > 0
            ? {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
              }
            : { method: 'POST' }
    );
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

// Fetch all generations for a workflow (lightweight summaries — no prompt or
// result payloads). Use fetchGeneration to load a single generation's full
// data when previewing its outputs.
export async function fetchGenerations(
    baseUrl: string,
    workflowId: string
): Promise<{ generations: GenerationSummary[] }> {
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
    const data = (await response.json()) as { generations: GenerationSummary[] };
    return { generations: Array.isArray(data.generations) ? data.generations : [] };
}

// Fetch a single generation's full data (prompt, result) by id.
// Called when previewing a generation's outputs — the list endpoint only
// returns lightweight summaries, so the full entry is fetched on demand.
export async function fetchGeneration(
    baseUrl: string,
    workflowId: string,
    generateId: string
): Promise<{ generation: GenerationEntry }> {
    const url = `${baseUrl}/workflows/${encodeURIComponent(workflowId)}/generate/${encodeURIComponent(generateId)}`;
    const response = await fetch(url);
    if (!response.ok) {
        let message = `Failed to fetch generation (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { generation: GenerationEntry };
}

// Build the URL that serves a single generation result (image/video/audio)
// with its real Content-Type. Point <img src> / <video src> / <audio src>
// straight at it — no need to fetch the full generation entry and convert
// base64 data: URLs into blob URLs. File-backed results are 302-redirected
// to the server's static media mount (which streams them off disk with
// range support, so <video> playback + seeking works, including on Safari);
// the browser follows that redirect transparently.
export function generationResultUrl(
    baseUrl: string,
    workflowId: string,
    generateId: string,
    index: number
): string {
    return `${baseUrl}/workflows/${encodeURIComponent(workflowId)}/generate/${encodeURIComponent(generateId)}/result/${index}`;
}

// Fetch a generation's .log event trail — the timestamped line-per-event
// record the server writes next to the generation json while it processes
// the run (see POST /v1/comfy/cloud/prompt). Failed runs surface their
// terminal error here; generations without a .log file get a trail
// synthesized from their json (status + error), so a log always comes
// back. Opened from a failed generation on the OUTPUT tab for debugging.
export async function fetchGenerationLog(
    baseUrl: string,
    workflowId: string,
    generateId: string
): Promise<{ log: string }> {
    const url = `${baseUrl}/workflows/${encodeURIComponent(workflowId)}/generate/${encodeURIComponent(generateId)}/log`;
    const response = await fetch(url);
    if (!response.ok) {
        let message = `Failed to fetch generation log (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    const data = (await response.json()) as { log?: unknown };
    return { log: typeof data.log === 'string' ? data.log : '' };
}

// Update a generation entry (PUT) — e.g. with results after agent completion.
export async function updateGeneration(
    baseUrl: string,
    workflowId: string,
    generateId: string,
    body: Partial<Pick<GenerationEntry, 'status' | 'result' | 'generatedTime' | 'completedDate' | 'error'>>
): Promise<{ generation: GenerationEntry }> {
    const url = `${baseUrl}/workflows/${encodeURIComponent(workflowId)}/generate/${encodeURIComponent(generateId)}`;
    const response = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        let message = `Failed to update generation (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { generation: GenerationEntry };
}

// Delete a generation snapshot (json + its sibling .log event trail).
// Deleting a still-processing generation does not cancel its pod run —
// the server's background stream consumer simply stops updating the file.
export async function deleteGeneration(
    baseUrl: string,
    workflowId: string,
    generateId: string
): Promise<{ success: boolean; id: string }> {
    const url = `${baseUrl}/workflows/${encodeURIComponent(workflowId)}/generate/${encodeURIComponent(generateId)}`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) {
        let message = `Failed to delete generation (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }
    return (await response.json()) as { success: boolean; id: string };
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
