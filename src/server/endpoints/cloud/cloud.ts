// Cloud pod endpoint — POST /v1/comfy/cloud
//
// Dual-purpose endpoint:
//   1. Create mode: body = {"gpu": "4090" | "B300" | ..., "name"?} → pick
//      the spawner server list registered for that GPU under
//      comfyCloudServiceEndpoint (runtime/secret/private/modal/comfy.ts:
//      gpu → { serverName: spawnerUrl }), then try each server IN ORDER:
//      GET the spawner URL, which returns a 302 redirect to the spawned
//      pod's public proxy URL. A failed attempt (unreachable, non-redirect
//      status, missing Location) falls through to the next server; when
//      every server fails the request answers 503 so the user understands
//      no server is available to spawn the requested GPU. Returns
//      { pod_url } to the UI.
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

// GPU-keyed spawner registry — gpu → { serverName: spawnerUrl }. The map
// lives in runtime/secret/private/modal/comfy.ts; keyed loosely here so a
// GPU request resolves by string lookup (numeric keys like 4090 arrive as
// strings over JSON anyway).
const SPAWNER_BY_GPU = comfyCloudServiceEndpoint as Record<string, Record<string, string>>;

export const createCloudPod = asHandlerMethod(async (_request, parameters, _variables) => {
    const body = (parameters.body ?? {}) as {
        name?: string;
        pod_url?: string;
        gpu?: string;
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
    // The GPU requested by the UI selects the candidate spawner server
    // list. Each server is tried in registration order; the first one
    // whose spawner answers a 302 redirect wins, the rest act as
    // fallback. The _variables.spawnerUrl override (tests / ops) bypasses
    // the registry as a single-candidate list.
    const podName: string | undefined = body.name;

    let candidates: { server: string; url: string }[];
    const overrideUrl: string | undefined = _variables?.spawnerUrl;
    if (overrideUrl) {
        candidates = [{ server: 'override', url: overrideUrl }];
    } else {
        if (!body.gpu) {
            // The UI always sends a GPU — a missing one is a client bug,
            // reported with the valid options so it is self-explanatory.
            return {
                status: 400,
                response: {
                    error: 'Missing gpu — specify which GPU to spawn the pod on',
                    available_gpus: Object.keys(SPAWNER_BY_GPU)
                }
            };
        }
        const spawners = SPAWNER_BY_GPU[body.gpu];
        if (!spawners || Object.keys(spawners).length === 0) {
            return {
                status: 400,
                response: {
                    error: `Unknown gpu: ${body.gpu}`,
                    available_gpus: Object.keys(SPAWNER_BY_GPU)
                }
            };
        }
        candidates = Object.entries(spawners).map(([server, url]) => ({ server, url }));
    }

    // Try each candidate server in order (see spawnFromCandidates).
    const spawned = await spawnFromCandidates(candidates, podName);

    if (!spawned.location) {
        // Every candidate failed — no server is available to spawn the
        // requested GPU. 503 (Service Unavailable) is the honest signal:
        // capacity may return later, and the UI surfaces the error and the
        // per-server attempts verbatim.
        return {
            status: 503,
            response: {
                error: `No server available to spawn gpu=${body.gpu ?? 'override'} — every spawner failed`,
                attempts: spawned.attempts
            }
        };
    }

    const location = spawned.location;

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
            gpu: body.gpu,
            spawner: spawned.server,
            ...statusData,
            is_direct: isDirect
        }
    };
});

// ── Spawner request ──────────────────────────────────────────────────

/** One spawn candidate: a named spawner server from the GPU's list. */
export type SpawnCandidate = { server: string; url: string };

/** One failed spawn attempt, kept for the exhausted-list error report. */
export type SpawnAttempt = { server: string; error: string };

export type SpawnResult = {
    /** Spawned pod's public URL from the winning server's 302 Location; null when every candidate failed. */
    location: string | null;
    /** Name of the server that produced `location` (undefined on failure). */
    server?: string;
    /** Failure trail, in attempt order — every server tried before the outcome. */
    attempts: SpawnAttempt[];
};

/**
 * Walk the GPU's candidate servers IN ORDER: the first spawner that
 * answers a usable 302 redirect wins; ANY failure (unreachable host,
 * non-redirect status, redirect without Location) is recorded and the
 * next server is tried. Returns location=null once the whole list is
 * exhausted — the handler maps that to HTTP 503.
 */
export async function spawnFromCandidates(candidates: SpawnCandidate[], podName?: string): Promise<SpawnResult> {
    const attempts: SpawnAttempt[] = [];
    for (const candidate of candidates) {
        try {
            const location = await requestSpawn(candidate.url, podName);
            return { location, server: candidate.server, attempts };
        } catch (err: any) {
            const message = err?.message ?? String(err);
            console.error(`[cloud] Spawner "${candidate.server}" (${candidate.url}) failed: ${message}`);
            attempts.push({ server: candidate.server, error: message });
        }
    }
    return { location: null, attempts };
}

/**
 * GET one spawner URL and extract the spawned pod's public proxy URL from
 * its 302 redirect. The spawner URL is a direct endpoint — ?name=<pod_name>
 * names the pod. THROWS on every failure shape (invalid URL, unreachable
 * host, non-redirect status, redirect without a Location header) so the
 * caller can fall through to the next candidate server.
 */
export async function requestSpawn(spawnerUrl: string, podName?: string): Promise<string> {
    let spawnUrl: URL;
    try {
        spawnUrl = new URL(String(spawnerUrl));
    } catch {
        throw new Error(`Invalid spawner URL: ${spawnerUrl}`);
    }
    if (podName) {
        spawnUrl.searchParams.set('name', podName);
    }

    const upstream = await fetch(spawnUrl.toString(), {
        method: 'GET',
        redirect: 'manual' // Don't follow the 302 — we need the Location header
    });

    if (upstream.status === 302 || upstream.status === 301) {
        const location = upstream.headers.get('location');
        if (!location) {
            throw new Error(`Spawner returned ${upstream.status} but no Location header`);
        }
        return location;
    }

    // Non-redirect response is unexpected — include a body hint when there
    // is one (an error page, a plain-text refusal).
    const errorBody = await upstream.text().catch(() => '');
    throw new Error(
        `Spawner returned HTTP ${upstream.status} (expected 302 redirect)` + (errorBody ? `: ${errorBody}` : '')
    );
}

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
