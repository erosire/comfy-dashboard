// API client for the ComfyUI cloud (Beam pod) endpoints.
//
// Routes (see src/server/endpoints/comfy-dashboard.yml):
//
// Cloud:
//   POST /v1/comfy/cloud          → { container_id, pod_url } (create)
//                                or { health, models_dir, models } (status)
//   POST /v1/comfy/cloud/prompt   → NDJSON stream (raw Response)

// ── Types ──────────────────────────────────────────────────────────────

export type CloudCreateResult = {
    container_id: string;
    pod_url: string;
};

/** A single line in the NDJSON stream from POST /v1/comfy/cloud/prompt. */
export type CloudStreamEvent = {
    type: string;
    data: Record<string, unknown>;
};

// ── API Functions ──────────────────────────────────────────────────────

// Spawn a fresh ComfyUI pod on Beam and return its connection details.
export async function cloudCreate(
    baseUrl: string,
    options?: { name?: string }
): Promise<CloudCreateResult> {
    const url = `${baseUrl}/cloud`;

    const body: Record<string, string> = {};
    if (options?.name) {
        body.name = options.name;
    }

    const response = await fetch(url, {
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

    const data = await response.json() as CloudCreateResult;
    return {
        container_id: data.container_id,
        pod_url: data.pod_url,
    };
}

/**
 * Submit a workflow to a spawned pod and stream results back.
 *
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
