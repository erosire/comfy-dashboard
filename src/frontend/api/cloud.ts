// API client for the ComfyUI cloud dashboard endpoints.
//
// All calls go through the local server proxy at baseUrl (default
// http://192.168.8.128:5000). See src/server/endpoints/comfy-dashboard.yml.
//
// Routes:
//   POST /v1/comfy/cloud          → { pod_url, is_direct }  (create — spawner 302 redirect)
//                                or { health, models_dir, models, is_direct } (status)
//   POST /v1/comfy/cloud/prompt   → 202 { accepted } when workflow_id +
//                                generation_id are given (server consumes the
//                                pod stream and updates the generation json
//                                itself — poll /workflows/:id/generate for
//                                progress); otherwise NDJSON stream (raw
//                                Response) for the client to consume.
//
// The two-tier architecture mirrors beam_comfy_service.yaml:
//   Tier 1 — Spawner: GET /spawn.json on the Beam spawner creates a fresh
//            ComfyUI pod and returns its pod_url.
//   Tier 2 — ComfyProxy: The pod's public proxy (GET / for health+models,
//            POST / for prompt execution with NDJSON streaming).
//
// A pod_url can also front a DIRECT ComfyUI server instead of the Tier 2
// proxy. The server detects this by attempting the native ComfyUI
// websocket handshake at <pod_url>/ws (a refused connection → proxy) and
// reports it as `is_direct` on every response. Prompt submission then
// passes the flag back: `is_direct: true` makes /cloud/prompt open the
// native websocket + POST /prompt (fresh client_id per request, so jobs
// never cross-read each other's events) and translate the socket back
// into the same NDJSON vocabulary the proxy emits.

// ── Types ──────────────────────────────────────────────────────────────

export type CloudCreateResult = {
    pod_url: string;
    /**
     * True when the pod_url fronts a DIRECT ComfyUI server (native
     * websocket reachable at /ws); false for the Tier 2 ComfyProxy shape.
     * Feed this back as `is_direct` when prompting the pod.
     */
    is_direct?: boolean;
    health?: {
        healthy: boolean;
        system_stats?: Record<string, unknown>;
        error?: string;
    };
    models_dir?: string;
    models?: Record<string, string[]>;
};

export type CloudPodStatusResult = {
    health: {
        healthy: boolean;
        system_stats?: Record<string, unknown>;
        error?: string;
    };
    /**
     * True when the pod_url fronts a DIRECT ComfyUI server (detected via
     * the native websocket handshake); false for the Tier 2 ComfyProxy.
     */
    is_direct?: boolean;
    /** Empty for direct ComfyUI pods — the native server lists no models. */
    models_dir?: string;
    /** Empty for direct ComfyUI pods — the native server lists no models. */
    models?: Record<string, string[]>;
};

/** A single line in the NDJSON stream from POST /v1/comfy/cloud/prompt. */
export type CloudStreamEvent = {
    type: string;
    data: Record<string, unknown>;
};

// ── Request types ─────────────────────────────────────────────────────

export type CloudRequest =
    | { type: 'create'; name?: string }
    | { type: 'status'; pod_url: string };

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
     * True when the pod is a DIRECT ComfyUI server (from the `is_direct`
     * reported by POST /v1/comfy/cloud). The server then opens the native
     * ComfyUI websocket with a FRESH client_id per request (overriding any
     * client_id sent here — each job owns its stream, no cross-talk) and
     * POSTs /prompt natively; omitted/false keeps the Tier 2 proxy flow.
     */
    is_direct?: boolean;
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

// ── Helpers ───────────────────────────────────────────────────────────

function isCreateRequest(req: CloudRequest): req is { type: 'create'; name?: string } {
    return req.type === 'create';
}

function isStatusRequest(req: CloudRequest): req is { type: 'status'; pod_url: string } {
    return req.type === 'status';
}

// ── Main API ──────────────────────────────────────────────────────────

/**
 * Unified cloud endpoint — acts as a switch over request types.
 *
 * All requests go through the server proxy at `baseUrl`.
 *
 * - `{ type: 'create', name? }` → `POST <baseUrl>/cloud` with `{}` or `{name}`.
 *   The server hits the Beam spawner (302 redirect) and returns `{ pod_url }`.
 *
 * - `{ type: 'status', pod_url }` → `POST <baseUrl>/cloud` with `{pod_url}`.
 *   The server probes the pod's Tier 2 proxy and returns
 *   `{ health, models_dir, models }`.
 */
export async function cloud(
    baseUrl: string,
    request: CloudRequest
): Promise<CloudCreateResult | CloudPodStatusResult> {
    if (isCreateRequest(request)) {
        return cloudCreate(baseUrl, request);
    }
    if (isStatusRequest(request)) {
        return cloudStatus(baseUrl, request);
    }
    // Exhaustiveness guard
    const _never: never = request;
    throw new Error(`Unknown cloud request type: ${JSON.stringify(_never)}`);
}

// ── Internal implementations ──────────────────────────────────────────

async function cloudCreate(
    baseUrl: string,
    request: { type: 'create'; name?: string }
): Promise<CloudCreateResult> {
    const body: Record<string, string> = {};
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
        } catch { /* ignore */ }
        throw new Error(message);
    }

    return (await response.json()) as CloudCreateResult;
}

async function cloudStatus(
    baseUrl: string,
    request: { type: 'status'; pod_url: string }
): Promise<CloudPodStatusResult> {
    const response = await fetch(`${baseUrl}/cloud`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pod_url: request.pod_url }),
    });

    if (!response.ok) {
        let message = `Failed to get pod status (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }

    return (await response.json()) as CloudPodStatusResult;
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
 *   - `{"type":"proxy_done","data":{}}` — success
 *   - `{"type":"execution_error",...}` — failure
 *   - `{"type":"proxy_error",...}` — proxy-level failure
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
 *       if (event.type === 'proxy_done') break;
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
