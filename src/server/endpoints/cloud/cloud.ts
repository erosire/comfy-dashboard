// Cloud pod endpoint — POST /v1/comfy/cloud
//
// Dual-purpose endpoint:
//   1. Create mode: body = {} or {"name": "..."} → GET the Beam spawner URL,
//      which returns a 302 redirect to the spawned pod's public proxy URL.
//      Returns { pod_url } to the UI.
//   2. Status mode: body = {"pod_url": "..."} → probe the Tier 2 proxy of
//      an existing pod and return { health, models_dir, models }.
//
// Both modes also DETECT what the pod_url actually fronts: it can be a
// Tier 2 ComfyProxy (current implementation — its GET / answers the JSON
// status document) or a DIRECT ComfyUI server (its GET / serves the
// ComfyUI frontend HTML instead). The detection probe attempts to open
// the native ComfyUI websocket at <pod_url>/ws?clientId=<id> — when the
// handshake completes the pod is a direct ComfyUI; when the connection is
// refused (or fails/times out) it is not. The response carries the result
// as `is_direct`, which POST /v1/comfy/cloud/prompt then accepts to pick
// the native websocket flow over the proxy flow.
//
// A direct ComfyUI answers no JSON status document at GET /, so its
// health is rebuilt from the native GET /system_stats instead
// (models are not listed on the native server — the listing stays empty).

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
 * Probe one pod_url: run the Tier 2 proxy JSON status GET and the direct
 * ComfyUI websocket handshake CONCURRENTLY (their outcomes are independent
 * — a proxy won't answer the socket, a direct ComfyUI won't answer JSON).
 *
 * A direct ComfyUI gets a status document synthesized from its native
 * GET /system_stats so health/heartbeat callers keep working against it.
 */
async function probePod(podUrl: URL): Promise<PodProbe> {
    const [jsonProbe, isDirect] = await Promise.all([probeJsonStatus(podUrl), probeDirectComfyUI(podUrl)]);

    if (jsonProbe.data !== undefined) {
        return { statusData: jsonProbe.data, isDirect };
    }

    if (isDirect) {
        return { statusData: await probeDirectHealth(podUrl), isDirect };
    }

    return { statusData: null, isDirect, error: jsonProbe.error, detail: jsonProbe.detail };
}

type JsonProbe = { data?: any; error?: string; detail?: string };

/** The Tier 2 proxy probe: GET / must answer a JSON status document. */
async function probeJsonStatus(podUrl: URL): Promise<JsonProbe> {
    let upstream: Response;
    try {
        upstream = await fetch(podUrl.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS)
        });
    } catch (err: any) {
        return { error: `Failed to reach pod: ${err?.message ?? String(err)}` };
    }

    if (!upstream.ok) {
        const detail = await upstream.text().catch(() => '');
        return { error: `Pod returned HTTP ${upstream.status}`, detail: detail || undefined };
    }

    try {
        return { data: await upstream.json() };
    } catch {
        // A direct ComfyUI serves its frontend HTML here — not a JSON
        // document. Whether that makes the pod usable is decided by the
        // websocket probe running alongside this one.
        return { error: 'Pod did not return a JSON status document' };
    }
}

/**
 * Rebuild the proxy-shaped status document for a direct ComfyUI pod from
 * its native GET /system_stats. Models are not listed on the native
 * server, so the listing stays empty; the websocket handshake already
 * proved ComfyUI is up, so a failed stats fetch still reports healthy.
 */
async function probeDirectHealth(podUrl: URL): Promise<any> {
    try {
        const upstream = await fetch(serverRoute(podUrl, '/system_stats').toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(STATUS_PROBE_TIMEOUT_MS)
        });
        if (upstream.ok) {
            const system_stats = await upstream.json();
            return { health: { healthy: true, system_stats }, models_dir: '', models: {} };
        }
        console.warn(`[cloud] Direct pod /system_stats returned HTTP ${upstream.status}`);
    } catch (err: any) {
        console.warn(`[cloud] Direct pod /system_stats probe failed: ${err?.message ?? String(err)}`);
    }
    return { health: { healthy: true }, models_dir: '', models: {} };
}
