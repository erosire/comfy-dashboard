// Cloud pod endpoint — POST /v1/comfy/cloud
//
// Dual-purpose endpoint:
//   1. Create mode: body = {} or {"name": "..."} → GET the Beam spawner URL,
//      which returns a 302 redirect to the spawned pod's public proxy URL.
//      Returns { pod_url } to the UI.
//   2. Status mode: body = {"pod_url": "..."} → probe the Tier 2 proxy of
//      an existing pod and return { health, models_dir, models }.
//
// Both modes also DETECT what the pod_url actually fronts, with two
// independent probes:
//
//   1. GET / — a Tier 2 ComfyProxy answers its JSON status document
//      (health + models) here; a DIRECT ComfyUI server has NO health JSON
//      and answers its frontend HTML with plain HTTP 200 instead. So for
//      the direct shape the health check is literally "did the base URL
//      answer HTTP 200".
//   2. Websocket — the native ComfyUI handshake at
//      <pod_url>/ws?clientId=<id>. When it completes the pod is a direct
//      ComfyUI (is_direct: true); when the connection is refused (or
//      fails/times out) it is not. A completed handshake is itself proof
//      the HTTP server processes requests.
//
// The response carries the result as `is_direct`, which POST
// /v1/comfy/cloud/prompt then accepts to pick the native websocket flow
// over the proxy flow. A direct pod's health report is synthesized as
// { healthy: true } (HTTP 200 + websocket available), enriched with the
// native GET /system_stats when it answers; models are not listed on the
// native server — the listing stays empty.

import { asHandlerMethod } from '@underload/service';
import { comfyCloudServiceEndpoint } from '@runtime/secret/private';
import { serverRoute } from '../connect';
import { probeDirectComfyUI } from './direct-comfy';

// This is the spawner URL
const DEFAULT_SPAWNER_URL = comfyCloudServiceEndpoint.standard;

// Per-attempt budget for the pod status GET and the /system_stats fallback.
// A hung pod must not stall the endpoint on undici's 300 s default.
const STATUS_PROBE_TIMEOUT_MS = 10_000;

export const createCloudPod = asHandlerMethod(async (_request, parameters, _variables) => {
    const spawnerUrl: string = _variables?.spawnerUrl ?? DEFAULT_SPAWNER_URL;
    const body = (parameters.body ?? {}) as {
        name?: string;
        pod_url?: string;
    };

    // ── Status mode: probe existing pod ────────────────────────────
    if (body.pod_url) {
        let podUrl: URL;
        try {
            podUrl = new URL(body.pod_url);
        } catch {
            return {
                status: 400,
                response: { error: `Invalid pod_url: ${body.pod_url}` }
            };
        }

        const probe = await probePod(podUrl);
        if (probe.statusData) {
            return {
                status: 200,
                response: { ...probe.statusData, is_direct: probe.isDirect }
            };
        }

        console.error(`[cloud] Pod status probe failed for ${body.pod_url}: ${probe.error}`);
        return {
            status: 502,
            response: {
                error: probe.error ?? 'Failed to reach pod',
                detail: probe.detail,
                is_direct: probe.isDirect
            }
        };
    }

    // ── Create mode: spawn a new pod ──────────────────────────────
    // The spawner URL is a direct endpoint. GET it → 302 redirect to the
    // spawned pod's public proxy URL. Use ?name=<pod_name> to name the pod.
    const podName: string | undefined = body.name;

    let spawnUrl: URL;
    try {
        spawnUrl = new URL(String(spawnerUrl));
    } catch {
        console.error(`[cloud] Invalid spawner URL: ${spawnerUrl}`);
        return {
            status: 500,
            response: { error: 'Server misconfigured: invalid spawner URL' }
        };
    }
    if (podName) {
        spawnUrl.searchParams.set('name', podName);
    }

    try {
        const upstream = await fetch(spawnUrl.toString(), {
            method: 'GET',
            redirect: 'manual' // Don't follow the 302 — we need the Location header
        });

        if (upstream.status === 302 || upstream.status === 301) {
            const location = upstream.headers.get('location');
            if (!location) {
                console.error(`[cloud] Spawner returned ${upstream.status} but no Location header`);
                return {
                    status: 502,
                    response: { error: 'Spawner returned redirect with no Location header' }
                };
            }

            // The pod may not be ready yet — probe it for the health +
            // models listing AND whether it is a direct ComfyUI.
            let statusData: any;
            let isDirect: boolean;
            try {
                const podUrl = new URL(location);
                const probe = await probePod(podUrl);
                statusData = probe.statusData ?? { error: `Status probe failed: ${probe.error}` };
                isDirect = probe.isDirect;
            } catch (err: any) {
                console.error(`[cloud] Initial status probe failed for ${location}:`, err.message);
                statusData = { error: `Status probe failed: ${err.message}` };
                isDirect = false;
            }

            console.log('[cloud] spawn status response:', JSON.stringify(statusData, null, 2), `is_direct=${isDirect}`);

            return {
                status: 200,
                response: {
                    pod_url: location,
                    ...statusData,
                    is_direct: isDirect
                }
            };
        }

        // Non-redirect response is unexpected
        const errorBody = await upstream.text().catch(() => '');
        console.error(`[cloud] Spawner returned ${upstream.status} (expected 302): ${errorBody}`);
        return {
            status: 502,
            response: {
                error: `Spawner returned HTTP ${upstream.status} (expected 302 redirect)`,
                detail: errorBody || undefined
            }
        };
    } catch (err: any) {
        console.error(`[cloud] Failed to reach spawner at ${spawnUrl}:`, err.message);
        return {
            status: 502,
            response: {
                error: `Failed to reach spawner: ${err.message}`
            }
        };
    }
});

// ── Pod probing ───────────────────────────────────────────────────

type PodProbe = {
    /** Status document to return — null when the pod answered neither probe. */
    statusData: any | null;
    /** True when the pod's native ComfyUI websocket accepted a connection. */
    isDirect: boolean;
    /** Human-readable failure reason when statusData is null. */
    error?: string;
    /** Optional upstream detail (error body / non-JSON hint). */
    detail?: string;
};

/**
 * Probe one pod_url: run the base-URL GET and the direct ComfyUI websocket
 * handshake CONCURRENTLY (their outcomes are independent — a proxy won't
 * answer the socket, a direct ComfyUI won't answer a JSON status document).
 */
async function probePod(podUrl: URL): Promise<PodProbe> {
    const [http, isDirect] = await Promise.all([probeHttp(podUrl), probeDirectComfyUI(podUrl)]);

    // Tier 2 proxy — its JSON status document is the authoritative health
    // report.
    if (http.json !== undefined) {
        return { statusData: http.json, isDirect };
    }

    // Direct ComfyUI — there is NO health JSON on the native server. The
    // health check is exactly "base URL answered HTTP 200" + "websocket
    // available" (the completed handshake is itself proof the HTTP server
    // processes requests); synthesize the report from those signals.
    if (isDirect) {
        return { statusData: await probeDirectHealth(podUrl, http), isDirect: true };
    }

    // Neither a ComfyProxy (no JSON status document) nor a direct ComfyUI
    // (websocket refused) — the pod_url is unusable as-is.
    return {
        statusData: null,
        isDirect,
        error:
            http.error ??
            `Pod returned HTTP ${http.status ?? 200} without a status document and refused the ComfyUI websocket`,
        detail: http.detail
    };
}

type HttpProbe = {
    /** True when the base URL answered any 2xx — the server is alive. */
    ok: boolean;
    /** Parsed JSON body when the answer WAS a JSON document (Tier 2 proxy). */
    json?: any;
    /** Fetch-level failure (unreachable / connection refused / timed out). */
    error?: string;
    /** Non-2xx answer's status. */
    status?: number;
    /** Non-2xx answer's body hint. */
    detail?: string;
};

/**
 * GET the pod_url itself — the base health check. A Tier 2 proxy answers
 * its JSON status document here; a direct ComfyUI answers its frontend
 * HTML with HTTP 200 (no JSON), so the JSON body is optional.
 */
async function probeHttp(podUrl: URL): Promise<HttpProbe> {
    let upstream: Response;
    try {
        upstream = await fetch(podUrl.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS)
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
        // (its web app HTML is served here).
        return { ok: true };
    }
}

/**
 * Synthesize the proxy-shaped status document for a DIRECT ComfyUI pod.
 * The health signal is already established by the caller — base URL
 * answered HTTP 200 and the websocket handshake completed — so this only
 * enriches the report with the native GET /system_stats when it answers.
 * Models are not listed on the native server; the listing stays empty.
 */
async function probeDirectHealth(podUrl: URL, http: HttpProbe): Promise<any> {
    let system_stats: unknown;
    try {
        const upstream = await fetch(serverRoute(podUrl, '/system_stats').toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS)
        });
        if (upstream.ok) {
            system_stats = await upstream.json().catch(() => undefined);
        } else {
            console.warn(`[cloud] Direct pod /system_stats returned HTTP ${upstream.status}`);
        }
    } catch (err: any) {
        console.warn(`[cloud] Direct pod /system_stats probe failed: ${err?.message ?? String(err)}`);
    }

    return {
        health: {
            // healthy := HTTP 200 on the base URL AND the websocket
            // handshake succeeded (checked by the caller).
            healthy: true,
            checked: { http_ok: http.ok, websocket: true },
            ...(system_stats !== undefined ? { system_stats } : {})
        },
        models_dir: '',
        models: {}
    };
}
