// API client for the ComfyUI cloud (Beam pod) endpoints.
//
// Aligns with the Beam two-tier API (see deployment/beam/comfy/beam_comfy_service.yaml):
//
//   TIER 1 — SPAWNER  (e.g. https://comfy-spawner.beam.cloud)
//     GET /              → 302 redirect to a freshly-spawned pod
//     GET /spawn.json    → { container_id, url } (JSON alternative)
//
//   TIER 2 — COMFY PROXY  (per-pod URL, e.g. https://....beam.cloud:8188)
//     GET /              → { health, models_dir, models }
//     POST /             → enqueue prompt, stream NDJSON results
//
// The `cloud()` function mirrors the dual-purpose `GET /`:
//   - { type: 'create' }  → Tier 1: spawns a pod, catches the 302
//   - { type: 'status' }  → Tier 2: probes the pod's health

// ── Types ──────────────────────────────────────────────────────────────

export type CloudCreateResult = {
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

/** A single line in the NDJSON stream from POST <pod_url>/. */
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
 * Unified cloud endpoint — mirrors the Beam two-tier `GET /`.
 *
 * - `{ type: 'create', name? }`
 *     Tier 1 — `GET <spawnerUrl>/` with optional `?name=...`.
 *     The spawner responds HTTP 302 redirecting to the live pod URL.
 *     This function catches the redirect (does NOT follow it) and
 *     returns the `Location` header as `pod_url`.
 *
 * - `{ type: 'status', pod_url }`
 *     Tier 2 — `GET <pod_url>/` probes the pod's health and returns
 *     `{ health, models_dir, models }`.
 */
export async function cloud(
    spawnerUrl: string,
    request: CloudRequest
): Promise<CloudCreateResult | CloudPodStatusResult> {
    if (isCreateRequest(request)) {
        return cloudCreate(spawnerUrl, request);
    }
    if (isStatusRequest(request)) {
        return cloudStatus(request);
    }
    // Exhaustiveness guard
    const _never: never = request;
    throw new Error(`Unknown cloud request type: ${JSON.stringify(_never)}`);
}

// ── Tier 1 — Spawner ──────────────────────────────────────────────────

/**
 * Spawn a fresh ComfyUI pod.
 *
 * Calls `GET <spawnerUrl>/` (the Beam Tier 1 spawner). The spawner
 * responds HTTP 302 with `Location: <pod_url>` once the pod is live.
 * We use `redirect: 'manual'` to capture the Location without following
 * the redirect — following it would block until the pod finishes booting.
 */
async function cloudCreate(
    spawnerUrl: string,
    request: { type: 'create'; name?: string }
): Promise<CloudCreateResult> {
    const url = new URL('/', spawnerUrl);
    if (request.name) {
        url.searchParams.set('name', request.name);
    }

    const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual', // catch 302 — don't follow
    });

    // ── 302: redirect to the live pod URL ──────────────────────────
    if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        if (!location) {
            throw new Error(
                `Spawner returned ${response.status} but no Location header`
            );
        }
        return { pod_url: location };
    }

    // ── Non-302 error ──────────────────────────────────────────────
    if (!response.ok) {
        let message = `Failed to spawn pod (HTTP ${response.status})`;
        try {
            const data = await response.json();
            if (data?.error) message = data.error;
        } catch { /* ignore */ }
        throw new Error(message);
    }

    // ── Fallback: 200 JSON (e.g. GET /spawn.json path) ────────────
    const data = (await response.json()) as { container_id?: string; url?: string; pod_url?: string };
    const pod_url = data.url ?? data.pod_url;
    if (!pod_url) {
        throw new Error('Spawner returned 200 but no pod URL');
    }
    return { pod_url };
}

// ── Tier 2 — Comfy Proxy ──────────────────────────────────────────────

/**
 * Check the health of a running ComfyUI pod.
 *
 * Calls `GET <pod_url>/` (the Beam Tier 2 proxy) and returns the pod's
 * health status, system stats, and available models.
 */
async function cloudStatus(
    request: { type: 'status'; pod_url: string }
): Promise<CloudPodStatusResult> {
    const response = await fetch(request.pod_url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
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

/**
 * Submit a workflow to a spawned pod and stream results back.
 *
 * Calls `POST <pod_url>/` (the Beam Tier 2 proxy) with the ComfyUI
 * prompt graph. Returns the raw Response object — the caller must read
 * it as a stream of newline-delimited JSON (NDJSON). Each line is a
 * CloudStreamEvent.
 *
 * The stream ends when the caller receives:
 *   - `{"type":"proxy_done","data":{}}` — success
 *   - `{"type":"execution_error",...}` — failure
 *   - `{"type":"proxy_error",...}` — proxy-level failure
 */
export async function cloudPrompt(
    pod_url: string,
    body: {
        prompt: Record<string, unknown>;
        client_id?: string;
    }
): Promise<Response> {
    const payload: Record<string, unknown> = { prompt: body.prompt };
    if (body.client_id) {
        payload.client_id = body.client_id;
    }

    const response = await fetch(pod_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
 *   const response = await cloudPrompt(pod_url, { prompt });
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
