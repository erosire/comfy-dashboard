// API client for the ComfyUI cloud dashboard endpoints.
//
// All calls go through the dashboard service at baseUrl (default resolved by
// frontend/config.ts resolveDefaultBaseUrl() — http://localhost:5000/v1/comfy
// when the page's host domain is localhost, otherwise the LAN deployment
// http://192.168.8.128:5000/v1/comfy).
// See src/server/endpoints/comfy-dashboard.yaml.
//
// Routes:
//   GET  /v1/comfy/cloud          → { pods: CloudPodListEntry[] } — the
//                                server's active pods (one persistent
//                                websocket per pod) with in-flight prompt
//                                counts. THE ONLY pod-liveness source the UI
//                                uses: the pod buttons mirror this list
//                                (unknown → added, unlisted → removed); there
//                                are no per-pod status probes client-side.
//   POST /v1/comfy/cloud          → { pod_url, health, models_dir, models }
//                                (create blocks until the pod's persistent
//                                websocket is connected and held)
//   POST /v1/comfy/cloud/prompt   → 202 { accepted, client_id, prompt_id }
//                                when workflow_id + generation_id are given
//                                (server consumes the run off the pod's
//                                shared socket — matched by prompt_id —
//                                and updates the generation json/log itself;
//                                poll /workflows/:id/generate for progress);
//                                otherwise NDJSON stream (raw Response) off
//                                the same shared socket for the client.
//
// The spawner creates a fresh native ComfyUI pod; the server then keeps ONE
// websocket per pod in memory until the pod dies (pods are designed to
// terminate when idle and never reconnect). Every prompt rides that single
// socket — jobs are isolated by prompt_id, not by connection.

// ── Types ──────────────────────────────────────────────────────────────

export type CloudCreateResult = {
    pod_url: string;
    /**
     * The GPU the pod was spawned on (echoed back from the request) — the
     * pod button's label ("4090", "B300", …).
     */
    gpu?: string;
    /**
     * Name of the spawner server (within the GPU's server list) that
     * produced this pod — the fallback chain's winner.
     */
    spawner?: string;
    health?: {
        healthy: boolean;
        system_stats?: Record<string, unknown>;
        error?: string;
    };
    models_dir?: string;
    models?: Record<string, string[]>;
};

/**
 * One prompt queued on a cloud pod — the server's authoritative queue
 * record (server pod-socket.ts PodQueueEntry). The UI reads this verbatim;
 * it never tracks queue state itself.
 */
export type CloudPodQueueEntry = {
    /** ComfyUI prompt_id — the routing key on the pod's shared socket. */
    prompt_id: string;
    /** ComfyUI queue position from the POST /prompt ack, when numeric. */
    number: number | null;
    /** queued = accepted, awaiting execution; running = execution_start seen. */
    status: 'queued' | 'running';
    /** Dashboard ids lifted from the submission's extra_data, when present. */
    workflow_id?: string;
    generation_id?: string;
    /** ISO timestamp when the server registered the prompt on this pod. */
    queuedAt: string;
    /** ISO timestamp of the execution_start flip (null while queued). */
    startedAt: string | null;
};

/**
 * One active cloud pod reported by GET /v1/comfy/cloud — the server's
 * single persistent websocket per pod, with its in-flight prompt count and
 * its server-tracked queue.
 */
export type CloudPodListEntry = {
    /**
     * Normalized native ComfyUI URL (the server's registry key —
     * URL.toString() form, so a bare host carries a trailing slash).
     * Compare with `new URL(u).toString()` normalization, not raw strings.
     */
    pod_url: string;
    /** GPU the pod was spawned on (create echo), when known. */
    gpu?: string;
    /** Optional spawn-time pod name. */
    name?: string;
    /** The shared websocket's client id — every prompt on the pod uses it. */
    client_id: string;
    /** The pod's server-managed websocket is currently connected. */
    active: boolean;
    /** How many prompts the pod is currently processing (all generations). */
    prompts: number;
    /**
     * The pod's queued prompts — the server's authoritative record
     * (insertion-ordered, oldest first). Badge counts and the Auto load
     * balancer read this list's length; nothing is tracked client-side.
     */
    queue: CloudPodQueueEntry[];
    /** ISO timestamp when the persistent websocket connected. */
    connectedAt: string;
};

export type CloudPodListResult = {
    pods: CloudPodListEntry[];
};

/** A single line in the NDJSON stream from POST /v1/comfy/cloud/prompt. */
export type CloudStreamEvent = {
    type: string;
    data: Record<string, unknown>;
};

// ── Request types ─────────────────────────────────────────────────────

// Create REQUIRES the GPU — the server picks the spawner list keyed by it
// (comfyCloudServiceEndpoint) and falls through the servers in order,
// answering 503 when no server can spawn the requested GPU.
export type CloudCreateRequest = { gpu: string; name?: string };

/**
 * Prompt submission request body.
 * Mirrors beam_comfy_service PromptRequest schema.
 */
export type CloudPromptBody = {
    pod_url: string;
    /**
     * The workflow document to execute — the ORIGINAL workflow json
     * (v0.4/v1 editor format, as stored on generations). The server
     * converts it to the flat API prompt before forwarding to the pod;
     * documents already in API prompt format pass through unchanged.
     */
    prompt: Record<string, unknown>;
    /**
     * The server opens the native ComfyUI websocket with a FRESH client_id
     * per request (overriding any client_id sent here) and POSTs /prompt.
     */
    client_id?: string;
    extra_data?: Record<string, unknown>;
    front?: boolean;
    number?: number;
    /**
     * Server-side processing mode. When both are provided, the server
     * consumes the pod's NDJSON stream in the background and keeps the
     * generation json (same file the workflow generation API writes)
     * updated by itself. The request returns 202 immediately — observe
     * progress by polling the workflow's generation list.
     */
    workflow_id?: string;
    /** Generation entry id the server should update while processing. */
    generation_id?: string;
};

// ── Main API ──────────────────────────────────────────────────────────

/**
 * Create a cloud pod: `POST <baseUrl>/cloud` with `{gpu}` or `{gpu, name}`.
 *
 * The server tries the GPU's spawner servers in order (302 redirect) and
 * answers ONLY once the pod's persistent websocket is connected and held —
 * `{ pod_url }`, or 503 when no spawner could produce one (the error text
 * carries the per-server attempts).
 */
export async function cloudCreate(
    baseUrl: string,
    request: CloudCreateRequest
): Promise<CloudCreateResult> {
    const body: Record<string, string> = { gpu: request.gpu };
    if (request.name) {
        body.name = request.name;
    }

    const response = await fetch(`${baseUrl}/cloud`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        let message = `Failed to spawn cloud pod (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
            // 503 "no server available" carries the per-server attempts
            // trail — surface it so the user sees WHY each spawner failed.
            if (Array.isArray(data?.attempts)) {
                message += data.attempts
                    .map((a: { server?: string; error?: string }) => `\n• ${a.server}: ${a.error}`)
                    .join('');
            }
        } catch { /* ignore */ }
        throw new Error(message);
    }

    return (await response.json()) as CloudCreateResult;
}

// ── Pod listing ───────────────────────────────────────────────────────

/**
 * List the server's active cloud pods (GET <baseUrl>/cloud).
 *
 * Pure registry read on the server — every pod whose persistent websocket
 * is currently held, each with its `active` flag and the number of prompts
 * it is processing. The UI polls this to keep its pod buttons in sync —
 * listed pods get buttons, unlisted pods' buttons are removed (the server
 * only deregisters a pod whose socket is definitively dead).
 */
export async function cloudListPods(baseUrl: string): Promise<CloudPodListResult> {
    const response = await fetch(`${baseUrl}/cloud`, { method: 'GET' });

    if (!response.ok) {
        let message = `Failed to list cloud pods (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }

    return (await response.json()) as CloudPodListResult;
}

// ── Prompt streaming ──────────────────────────────────────────────────

/**
 * Submit a workflow to a spawned pod.
 *
 * Calls `POST <baseUrl>/cloud/prompt` with the full body (pod_url, prompt,
 * client_id?, extra_data?, front?, number?, workflow_id?, generation_id?).
 *
 * Server-side processing mode (workflow_id + generation_id provided):
 * returns immediately with 202 — the server consumes the pod stream and
 * updates the generation json itself; poll the generation list for
 * progress. The returned Response body is plain JSON and NOT a stream.
 *
 * Legacy mode: returns the raw Response object — the caller must read it
 * as a stream of newline-delimited JSON (NDJSON). Each line is a
 * CloudStreamEvent. The stream ends when the caller receives:
 *   - `{"type":"prompt_done","data":{}}` — success
 *   - `{"type":"execution_error",...}` — failure
 *   - `{"type":"prompt_error",...}` — websocket-level failure
 */
export async function cloudPrompt(
    baseUrl: string,
    body: CloudPromptBody
): Promise<Response> {
    const response = await fetch(`${baseUrl}/cloud/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });

    if (!response.ok && !response.headers.get('content-type')?.includes('ndjson')) {
        let message = `Failed to submit prompt (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }

    // Return the raw Response for streaming consumption
    return response;
}

/**
 * Convenience: read an NDJSON stream from a Response and yield parsed events.
 *
 * Usage:
 *   const response = await cloudPrompt(baseUrl, { pod_url, prompt });
 *   for await (const event of cloudReadNdjson(response)) {
 *       console.log(event.type, event.data);
 *       if (event.type === 'prompt_done') break;
 *   }
 */
export async function* cloudReadNdjson(
    response: Response
): AsyncGenerator<CloudStreamEvent, void, unknown> {
    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            const lines = buffer.split('\n');
            // Keep the last (potentially incomplete) line in the buffer
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                try {
                    const event = JSON.parse(trimmed) as CloudStreamEvent;
                    yield event;
                } catch {
                    // Skip malformed lines
                    console.warn('[cloudReadNdjson] Skipping malformed line:', trimmed);
                }
            }
        }

        // Process any remaining data in the buffer
        if (buffer.trim()) {
            try {
                const event = JSON.parse(buffer.trim()) as CloudStreamEvent;
                yield event;
            } catch {
                // Ignore trailing incomplete JSON
            }
        }
    } finally {
        reader.releaseLock();
    }
}
