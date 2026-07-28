// Cloud pod endpoint — POST /v1/comfy/cloud
//
// Dual-purpose endpoint:
//   1. Create mode: body = {} or {"name": "..."} → GET the Beam spawner URL,
//      which returns a 302 redirect to the spawned pod's public proxy URL.
//      Returns { pod_url } to the UI.
//   2. Status mode: body = {"pod_url": "..."} → probe the Tier 2 proxy of
//      an existing pod and return { health, models_dir, models }.

import { asHandlerMethod } from '@underload/service';
import { beamComfyCloud } from '@runtime/secret/private';

// This is the spawner URL
const DEFAULT_SPAWNER_URL = beamComfyCloud.lancerDiffusion;

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

        try {
            const upstream = await fetch(podUrl.toString(), {
                method: 'GET',
                headers: { Accept: 'application/json' }
            });

            if (!upstream.ok) {
                const errorBody = await upstream.text().catch(() => '');
                console.error(`[cloud] Pod status probe returned ${upstream.status}: ${errorBody}`);
                return {
                    status: 502,
                    response: {
                        error: `Pod returned HTTP ${upstream.status}`,
                        detail: errorBody || undefined
                    }
                };
            }

            const data = await upstream.json();
            return {
                status: 200,
                response: data
            };
        } catch (err: any) {
            console.error(`[cloud] Failed to reach pod at ${body.pod_url}:`, err.message);
            return {
                status: 502,
                response: {
                    error: `Failed to reach pod: ${err.message}`
                }
            };
        }
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
            return {
                status: 200,
                response: {
                    pod_url: location
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
