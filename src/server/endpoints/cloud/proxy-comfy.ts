// Tier 2 proxy (ComfyProxy) pod support for the cloud endpoints.
//
// One of the two comfy server shapes a pod_url can front (see
// ./direct-comfy.ts for the other;./cloud.ts probes both shapes and
// ./cloud-prompt.ts dispatches the submission by `is_direct`):
//
//   - Tier 2 proxy (this module): GET / answers a JSON
//     {health, models_dir, models} status document, and POST / executes a
//     prompt while streaming progress back as NDJSON
//     (application/x-ndjson). There is no reachable ComfyUI websocket on
//     that URL — the native handshake is refused.
//
//   - Direct ComfyUI (./direct-comfy.ts): the pod_url IS the ComfyUI
//     server; GET / serves the frontend HTML and prompts run over the
//     native websocket + POST /prompt.
//
// Detection (probeProxyStatus) is the base-URL GET: a proxy's answer IS
// the health report (its JSON status document), so "2xx with a JSON body"
// is the proxy signature. A direct ComfyUI answers HTTP 200 WITHOUT JSON
// (its frontend HTML), which reads as "not a proxy" here — the websocket
// probe in ./direct-comfy.ts is the independent check for that shape.
//
// Prompt submission (submitProxyPrompt) POSTs the beam_comfy_service
// PromptRequest payload to the pod_url itself and hands the Response back
// untouched — its NDJSON body is already the canonical event vocabulary
// every consumer (server-side generation processing, legacy client
// streaming) speaks, and it is the vocabulary ./direct-comfy.ts
// translates its websocket back into. A native ComfyUI server has no
// POST / route and answers HTTP 405 instead: ./cloud-prompt.ts treats
// that as a stale is_direct flag and retries the submission over the
// direct flow.
//
// To add a THIRD comfy server shape: create a sibling module here with a
// detection/status probe and a `submit<Prompt>` that resolves to a
// Response in the same NDJSON vocabulary, then wire its probe into
// probePod (./cloud.ts) and its submit branch into cloudPrompt
// (./cloud-prompt.ts).

import { Agent } from 'undici';

/**
 * Per-attempt budget for the pod status GET. A hung pod must not stall
 * the endpoint on undici's 300 s default.
 */
export const PROXY_STATUS_PROBE_TIMEOUT_MS = 10_000;

/**
 * Pod-facing dispatcher for proxy submissions with ALL undici timeouts
 * disabled.
 *
 * Why this exists: fetch()'s RequestInit silently DROPS unknown keys (per
 * WebIDL), so a `bodyTimeout: 0` init option never reaches undici and the
 * global Agent's default 300 s body timeout stays in force. That timeout
 * measures the gap BETWEEN response body chunks — and a queued ComfyUI
 * prompt's NDJSON stream legitimately emits nothing for its prompt_id
 * until it starts executing, so exactly ~305 s after enqueue the body
 * read dies with `TypeError: terminated` while the pod keeps processing.
 * Timeouts live on the Dispatcher (Agent/Client), and `dispatcher` is the
 * one undici-specific fetch init key that IS honored. 0 = disabled: the
 * stream ends when the pod ends it, never at a client-side deadline. (The
 * direct flow in ./direct-comfy.ts needs no dispatcher — it owns the
 * websocket.)
 */
const podAgent = new Agent({
    headersTimeout: 0,
    bodyTimeout: 0,
});

export type ProxyStatusProbe = {
    /** True when the base URL answered any 2xx — the server is alive. */
    ok: boolean;
    /** Parsed JSON body when the answer WAS a JSON status document (the Tier 2 proxy health report). */
    json?: any;
    /** Fetch-level failure (unreachable / connection refused / timed out). */
    error?: string;
    /** Non-2xx answer's status. */
    status?: number;
    /** Non-2xx answer's body hint. */
    detail?: string;
};

/**
 * Tier 2 proxy detection probe: GET the pod_url itself. The proxy answers
 * its JSON status document ({health, models_dir, models}) here — that
 * document IS the health report, returned on `json`. A direct ComfyUI
 * answers its frontend HTML with plain HTTP 200 (no JSON), so the probe
 * then comes back `ok` WITHOUT `json` and the websocket probe in
 * ./direct-comfy.ts decides whether the direct shape applies.
 */
export async function probeProxyStatus(
    podUrl: URL,
    timeoutMs: number = PROXY_STATUS_PROBE_TIMEOUT_MS
): Promise<ProxyStatusProbe> {
    let upstream: Response;
    try {
        upstream = await fetch(podUrl.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(timeoutMs)
        });
    } catch (err: any) {
        return { ok: false, error: `Failed to reach pod: ${err?.message ?? String(err)}` };
    }

    if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        return { ok: false, status: upstream.status, detail: detail || undefined };
    }

    try {
        return { ok: true, json: await upstream.json() };
    } catch {
        // HTTP 200 but no JSON body — the signature of a direct ComfyUI
        // (its web app HTML is served here), NOT of a proxy.
        return { ok: true };
    }
}

export type ProxySubmitOptions = {
    podUrl: URL;
    /**
     * The full prompt payload (beam_comfy_service PromptRequest — the
     * prompt already converted to the flat API format, plus client_id /
     * extra_data / front / number when used).
     */
    promptPayload: Record<string, unknown>;
    /** Forwarded Authorization header for authenticated pods. */
    authorization?: string;
};

/**
 * Submit a prompt to a Tier 2 ComfyProxy pod (is_direct: false | omitted
 * flow): POST the payload to the pod_url itself and return the pod's own
 * Response untouched — on success it carries the NDJSON execution stream
 * (application/x-ndjson); on failure it carries the pod's real status and
 * JSON error for the caller's shared !ok error path.
 *
 * A native ComfyUI server has no POST / route, so this can also answer
 * HTTP 405 — the caller (./cloud-prompt.ts) retries that submission over
 * the direct websocket flow (stale is_direct flag self-heal).
 */
export async function submitProxyPrompt(options: ProxySubmitOptions): Promise<Response> {
    const { podUrl, promptPayload, authorization } = options;

    const forwardedHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson'
    };
    if (authorization) {
        forwardedHeaders['Authorization'] = authorization;
    }

    return fetch(podUrl.toString(), {
        method: 'POST',
        headers: forwardedHeaders,
        body: JSON.stringify(promptPayload),
        // @ts-expect-error -- undici-specific fetch init key (omitted from
        // the DOM RequestInit type): route through the timeout-free
        // dispatcher, see podAgent above.
        dispatcher: podAgent
    });
}
