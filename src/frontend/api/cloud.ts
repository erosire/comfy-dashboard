// API client for the ComfyUI cloud dashboard endpoints.
//
// All calls go through the local server proxy at baseUrl (default
// http://192.168.8.128:5000). See src/server/endpoints/comfy-dashboard.yml.
//
// Routes:
//   POST /v1/comfy/cloud          → { container_id, pod_url }  (create)
//                                or { health, models_dir, models } (status)
//   POST /v1/comfy/cloud/prompt   → NDJSON stream (raw Response)

// ── Types ──────────────────────────────────────────────────────────────

export type CloudCreateResult = {
    container_id: string;
    pod_url: string;
};

export type CloudPodStatusResult = {
    health: {
        healthy: boolean;
        system_stats?: Record<string, unknown>;
        error?: string;
    };
    models_dir: string;
    models: Record<string, string[]>;
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
 *   The server spawns a pod via Beam and returns `{ container_id, pod_url }`.
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
        let message = `Failed to create cloud pod (HTTP ${response.status})`;
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
 * Submit a workflow to a spawned pod and stream results back.
 *
 * Calls `POST <baseUrl>/cloud/prompt` with `{ pod_url, prompt, client_id? }`.
 * Returns the raw Response object — the caller must read it as a stream
 * of newline-delimited JSON (NDJSON). Each line is a CloudStreamEvent.
 *
 * The stream ends when the caller receives:
 *   - `{"type":"proxy_done","data":{}}` — success
 *   - `{"type":"execution_error",...}` — failure
 *   - `{"type":"proxy_error",...}` — proxy-level failure
 */
export async function cloudPrompt(
    baseUrl: string,
    body: {
        pod_url: string;
        prompt: Record<string, unknown>;
        client_id?: string;
    }
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
