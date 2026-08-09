// Cloud pod endpoints — POST + GET /v1/comfy/cloud.
//
// POST has two request modes:
//   - create: select a GPU, ask the configured spawner for a pod URL, then
//     open the pod's ONE persistent ComfyUI websocket (pod-socket.ts). The
//     endpoint answers ONLY once the websocket is connected and held in
//     server memory — a pod that refuses its socket is NOT returned (502).
//     The connection is then maintained forever (protocol pings) until the
//     cloud server terminates it — pods are designed to die when idle and
//     never come back, so a dropped socket is final.
//   - status: report an existing pod through the registry. A pod the server
//     does not track yet (e.g. after a restart) is adopted — its persistent
//     websocket is opened and registered — so the status answer always
//     reflects the single server-managed socket.
//
// GET returns the list of active pods straight from the registry, each with
// its liveness flag, in-flight prompt count, and the server-tracked queue
// list (prompt_id, queued/running status, workflow/generation ids), so
// dashboards keep their pod buttons purely in sync with the API — they
// track no pod state themselves.
//
// Every pod is a native ComfyUI server. The persistent websocket is the
// authoritative connection; /system_stats remains best-effort enrichment.

import { asHandlerMethod } from '@underload/service';
import { comfyCloudServiceEndpoint } from '@runtime/secret/private';
import { probeDirectHealth } from './direct-comfy';
import { connectPodSocket, listPodSockets } from './pod-socket';

// GPU-keyed spawner registry — gpu → { serverName: spawnerUrl }. The map is
// keyed loosely because JSON request keys are strings even for numeric GPUs.
const SPAWNER_BY_GPU = comfyCloudServiceEndpoint as Record<string, Record<string, string>>;

// Keep the service adapter's request shape local so status and create mode
// cannot accidentally accept transport-selection fields from old clients.
type CloudRequestBody = {
    name?: string;
    pod_url?: string;
    gpu?: string;
};

// GET /v1/comfy/cloud — active pods + per-pod in-flight prompt counts.
// Pure registry read: no pod is contacted, so the answer is instant.
export const listCloudPods = asHandlerMethod(async () => {
    return { status: 200, response: { pods: listPodSockets() } };
});

export const createCloudPod = asHandlerMethod(async (_request, parameters, _variables) => {
    const body = (parameters.body ?? {}) as CloudRequestBody;

    // Status mode reports (and when needed adopts) an already-spawned pod
    // through the single server-managed websocket.
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

        try {
            // Reuses the existing persistent socket or opens/registers it.
            await connectPodSocket(podUrl);
        } catch (error: any) {
            console.error(`[cloud] Direct ComfyUI connect failed for ${body.pod_url}: ${error?.message ?? String(error)}`);
            return {
                status: 502,
                response: { error: `Pod refused the direct ComfyUI websocket: ${error?.message ?? String(error)}` }
            };
        }

        try {
            return { status: 200, response: await probeDirectHealth(podUrl) };
        } catch (error: any) {
            return {
                status: 502,
                response: { error: `Direct ComfyUI health probe failed: ${error?.message ?? String(error)}` }
            };
        }
    }

    // Create mode requires a GPU so the server can choose its registered
    // spawner list and preserve the configured fallback order.
    const podName = body.name;
    let candidates: SpawnCandidate[];
    const overrideUrl: string | undefined = _variables?.spawnerUrl;
    if (overrideUrl) {
        candidates = [{ server: 'override', url: overrideUrl }];
    } else {
        if (!body.gpu) {
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

    // A spawner redirect supplies the native ComfyUI pod URL. A failed
    // candidate is recorded and the next configured candidate is attempted.
    const spawned = await spawnFromCandidates(candidates, podName);
    if (!spawned.location) {
        return {
            status: 503,
            response: {
                error: `No server available to spawn gpu=${body.gpu ?? 'override'} — every spawner failed`,
                attempts: spawned.attempts
            }
        };
    }

    // The pod only becomes usable once its ONE persistent websocket is
    // connected and registered. Until then the create request blocks; a pod
    // that refuses its socket is not handed out at all.
    const location = spawned.location;
    try {
        await connectPodSocket(new URL(location), { gpu: body.gpu, name: podName });
    } catch (error: any) {
        console.error(`[cloud] Spawned pod ${location} refused its websocket:`, error?.message ?? String(error));
        return {
            status: 502,
            response: {
                error: `Spawned pod refused the direct ComfyUI websocket: ${error?.message ?? String(error)}`
            }
        };
    }

    // With the socket held, /system_stats is best-effort enrichment only.
    let statusData: Record<string, unknown>;
    try {
        statusData = await probeDirectHealth(new URL(location));
    } catch (error: any) {
        console.error(`[cloud] Initial direct ComfyUI health probe failed for ${location}:`, error?.message ?? String(error));
        statusData = { error: `Status probe failed: ${error?.message ?? String(error)}` };
    }

    // Keep the server log compact while passing the URL as its own console
    // argument so terminal integrations can recognize and open it directly.
    console.log('[cloud] spawn status success:', location);
    return {
        status: 200,
        response: {
            pod_url: location,
            gpu: body.gpu,
            spawner: spawned.server,
            ...statusData
        }
    };
});

// One spawn candidate is a named server from the selected GPU's registry.
export type SpawnCandidate = { server: string; url: string };

// Failed attempts stay in order so a capacity error identifies every server
// that was tried before the endpoint returned 503.
export type SpawnAttempt = { server: string; error: string };

export type SpawnResult = {
    location: string | null;
    server?: string;
    attempts: SpawnAttempt[];
};

// Walk candidates in registration order and stop at the first usable redirect.
export async function spawnFromCandidates(candidates: SpawnCandidate[], podName?: string): Promise<SpawnResult> {
    const attempts: SpawnAttempt[] = [];
    for (const candidate of candidates) {
        try {
            const location = await requestSpawn(candidate.url, podName);
            return { location, server: candidate.server, attempts };
        } catch (error: any) {
            const message = error?.message ?? String(error);
            console.error(`[cloud] Spawner "${candidate.server}" (${candidate.url}) failed: ${message}`);
            attempts.push({ server: candidate.server, error: message });
        }
    }
    return { location: null, attempts };
}

// Request one spawner URL without following its redirect so the returned
// Location remains the public native ComfyUI URL selected by the spawner.
export async function requestSpawn(spawnerUrl: string, podName?: string): Promise<string> {
    let spawnUrl: URL;
    try {
        spawnUrl = new URL(String(spawnerUrl));
    } catch {
        throw new Error(`Invalid spawner URL: ${spawnerUrl}`);
    }
    if (podName) spawnUrl.searchParams.set('name', podName);

    const upstream = await fetch(spawnUrl.toString(), { method: 'GET', redirect: 'manual' });
    if (upstream.status === 302 || upstream.status === 301) {
        const location = upstream.headers.get('location');
        if (!location) throw new Error(`Spawner returned ${upstream.status} but no Location header`);
        return location;
    }

    // Include a short response body hint because spawners commonly use plain
    // text to explain capacity and authentication failures.
    const errorBody = await upstream.text().catch(() => '');
    throw new Error(
        `Spawner returned HTTP ${upstream.status} (expected 302 redirect)` + (errorBody ? `: ${errorBody}` : '')
    );
}
