// Cloud pod endpoint — POST /v1/comfy/cloud
//
// Dual-purpose endpoint:
//   1. Create mode: body = {} or {"name": "..."} → GET the Beam spawner URL,
//      which returns a 302 redirect to the spawned pod's public proxy URL.
//      Returns { pod_url } to the UI.
//   2. Status mode: body = {"pod_url": "..."} → probe an existing pod and
//      return { health, models_dir, models }.
//
// Both modes DETECT what kind of comfy server the pod_url fronts. Each
// pod shape owns a sibling module here (add a new one in the same style
// when a shape appears, then wire its probe into probePod below):
//
//   - Proxy (./proxy-comfy.ts) — the Tier 2 ComfyProxy. Detection: GET /
//     answers its JSON status document (health + models) — that document
//     IS the health report.
//   - Direct ComfyUI (./direct-comfy.ts) — the pod_url IS the ComfyUI
//     server. Detection: the native websocket handshake at
//     <pod_url>/ws?clientId=<id> (is_direct: true when it completes; a
//     completed handshake is itself proof the HTTP server processes
//     requests). The direct shape has NO health JSON — GET / serves the
//     frontend HTML — so its health check is literally "did the base URL
//     answer HTTP 200" plus "websocket available", synthesized and
//     enriched with the native GET /system_stats when it answers.
//
// The response carries the result as `is_direct`, which POST
// /v1/comfy/cloud/prompt then accepts to pick the native websocket flow
// over the proxy flow.

import { asHandlerMethod } from '@underload/service';
import { comfyCloudServiceEndpoint } from '@runtime/secret/private';
import { probeDirectComfyUI, probeDirectHealth } from './direct-comfy';
import { probeProxyStatus } from './proxy-comfy';

// This is the spawner URL
const DEFAULT_SPAWNER_URL = comfyCloudServiceEndpoint.standard;

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

// ── Pod probing (dispatch across the comfy server shapes) ────────────

type PodProbe = {
    /** Status document to return — null when the pod answered neither shape's probe. */
    statusData: any | null;
    /** True when the pod's native ComfyUI websocket accepted a connection. */
    isDirect: boolean;
    /** Human-readable failure reason when statusData is null. */
    error?: string;
    /** Optional upstream detail (error body / non-JSON hint). */
    detail?: string;
};

/**
 * Probe one pod_url: run every shape's detection probe CONCURRENTLY (their
 * outcomes are independent — a proxy won't answer the direct websocket, a
 * direct ComfyUI won't answer a JSON status document), then pick the
 * status document of whichever shape answered. A THIRD comfy server shape
 * adds its own probe here (from its own module) plus its selection rule.
 */
async function probePod(podUrl: URL): Promise<PodProbe> {
    const [proxy, isDirect] = await Promise.all([probeProxyStatus(podUrl), probeDirectComfyUI(podUrl)]);

    // Tier 2 proxy (./proxy-comfy.ts) — its JSON status document is the
    // authoritative health report.
    if (proxy.json !== undefined) {
        return { statusData: proxy.json, isDirect };
    }

    // Direct ComfyUI (./direct-comfy.ts) — there is NO health JSON on the
    // native server. The health check is exactly "base URL answered
    // HTTP 200" + "websocket available" (the completed handshake is itself
    // proof the HTTP server processes requests); synthesize the report from
    // those signals.
    if (isDirect) {
        return { statusData: await probeDirectHealth(podUrl, proxy), isDirect: true };
    }

    // Neither a ComfyProxy (no JSON status document) nor a direct ComfyUI
    // (websocket refused) — the pod_url is unusable as-is.
    return {
        statusData: null,
        isDirect,
        error:
            proxy.error ??
            `Pod returned HTTP ${proxy.status ?? 200} without a status document and refused the ComfyUI websocket`,
        detail: proxy.detail
    };
}
