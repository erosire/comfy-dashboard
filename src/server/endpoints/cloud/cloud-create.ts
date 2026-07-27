// Cloud create endpoint — GET /api/cloud/create
//
// Spawns a fresh ComfyUI pod via the Beam spawner (Tier 1) and returns
// the pod's container_id and public proxy URL to the client.
//
// Wraps: GET <spawnerUrl>/spawn.json  →  { container_id, url }

import { asHandlerMethod } from '@underload/service';

const DEFAULT_SPAWNER_URL = 'https://comfy-spawner.beam.cloud';

export const cloudCreate = asHandlerMethod(async (_request, parameters, variables) => {
    const spawnerUrl: string = variables?.spawnerUrl ?? DEFAULT_SPAWNER_URL;
    const podName: string | undefined = parameters.query.name;

    // Build the spawn.json URL, optionally passing a pod name
    const url = new URL('/spawn.json', spawnerUrl);
    if (podName) {
        url.searchParams.set('name', podName);
    }

    try {
        const upstream = await fetch(url.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });

        if (!upstream.ok) {
            const errorBody = await upstream.text().catch(() => '');
            console.error(`[cloud/create] Spawner returned ${upstream.status}: ${errorBody}`);
            return {
                status: 502,
                response: {
                    error: `Spawner returned HTTP ${upstream.status}`,
                    detail: errorBody || undefined,
                },
            };
        }

        const data = await upstream.json() as { container_id: string; url: string };

        return {
            status: 200,
            response: {
                container_id: data.container_id,
                pod_url: data.url,
            },
        };
    } catch (err: any) {
        console.error(`[cloud/create] Failed to reach spawner at ${spawnerUrl}:`, err.message);
        return {
            status: 502,
            response: {
                error: `Failed to reach spawner: ${err.message}`,
            },
        };
    }
});
