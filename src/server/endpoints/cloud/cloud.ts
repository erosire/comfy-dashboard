// Cloud pod endpoint — POST /v1/comfy/cloud.
//
// The endpoint has two request modes:
//   - create: select a GPU, ask the configured spawner for a pod URL, and
//     return the URL plus the direct ComfyUI health snapshot;
//   - status: probe an existing pod's native ComfyUI websocket and return its
//     direct health snapshot.
//
// Every pod is a native ComfyUI server. The websocket handshake is therefore
// the authoritative connection check; no alternate HTTP transport or server
// shape is detected, selected, or reported by this endpoint.

import { asHandlerMethod } from '@underload/service';
import { comfyCloudServiceEndpoint } from '@runtime/secret/private';
import { probeDirectComfyUI, probeDirectHealth } from './direct-comfy';

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

// The probe result contains only native ComfyUI data. A null status means the
// websocket did not open and the URL cannot be used for a direct run.
type PodProbe = {
    statusData: Record<string, unknown> | null;
    error?: string;
    detail?: string;
};

export const createCloudPod = asHandlerMethod(async (_request, parameters, _variables) => {
    const body = (parameters.body ?? {}) as CloudRequestBody;

    // Status mode validates and checks an already-spawned native server.
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
            return { status: 200, response: probe.statusData };
        }

        console.error(`[cloud] Direct ComfyUI probe failed for ${body.pod_url}: ${probe.error}`);
        return {
            status: 502,
            response: {
                error: probe.error ?? 'Failed to reach direct ComfyUI pod',
                detail: probe.detail
            }
        };
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

    const location = spawned.location;
    let statusData: Record<string, unknown>;
    try {
        const probe = await probePod(new URL(location));
        statusData = probe.statusData ?? { error: `Status probe failed: ${probe.error}` };
    } catch (error: any) {
        console.error(`[cloud] Initial direct ComfyUI probe failed for ${location}:`, error?.message ?? String(error));
        statusData = { error: `Status probe failed: ${error?.message ?? String(error)}` };
    }

    console.log('[cloud] spawn status response:', JSON.stringify(statusData, null, 2));
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

// Probe only the native websocket. The direct health snapshot performs the
// optional HTTP metadata requests after this handshake succeeds.
async function probePod(podUrl: URL): Promise<PodProbe> {
    const connected = await probeDirectComfyUI(podUrl);
    if (!connected) {
        return {
            statusData: null,
            error: 'Pod refused the direct ComfyUI websocket'
        };
    }

    try {
        return { statusData: await probeDirectHealth(podUrl) };
    } catch (error: any) {
        return {
            statusData: null,
            error: `Direct ComfyUI health probe failed: ${error?.message ?? String(error)}`
        };
    }
}
