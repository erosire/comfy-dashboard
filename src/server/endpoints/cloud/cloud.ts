// Cloud pod endpoint — POST /v1/comfy/cloud
//
// Dual-purpose endpoint:
//   1. Create mode: body = {} or {"name": "..."} → spawn a new ComfyUI pod
//      via the Beam spawner (Tier 1) and return { container_id, pod_url }.
//   2. Status mode: body = {"pod_url": "..."} → probe the Tier 2 proxy of
//      an existing pod and return { health, models_dir, models }.

import { asHandlerMethod } from '@underload/service';
import { beamComfyCloud } from '@runtime/secret/private';

// This is the spawner URL
const DEFAULT_SPAWNER_URL = beamComfyCloud;

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
    const podName: string | undefined = body.name;

    const url = new URL('/spawn.json', spawnerUrl);
    if (podName) {
        url.searchParams.set('name', podName);
    }

    try {
        const upstream = await fetch(url.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' }
        });

        if (!upstream.ok) {
            const errorBody = await upstream.text().catch(() => '');
            console.error(`[cloud] Spawner returned ${upstream.status}: ${errorBody}`);
            return {
                status: 502,
                response: {
                    error: `Spawner returned HTTP ${upstream.status}`,
                    detail: errorBody || undefined
                }
            };
        }

        const data = (await upstream.json()) as { container_id: string; url: string };

        return {
            status: 200,
            response: {
                container_id: data.container_id,
                pod_url: data.url
            }
        };
    } catch (err: any) {
        console.error(`[cloud] Failed to reach spawner at ${spawnerUrl}:`, err.message);
        return {
            status: 502,
            response: {
                error: `Failed to reach spawner: ${err.message}`
            }
        };
    }
});
