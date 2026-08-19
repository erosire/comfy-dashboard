// =============================================================================
// GPU-keyed spawner selection tests (endpoints/cloud/cloud.ts).
//
// POST /v1/comfy/cloud create mode requires a `gpu` key; the server resolves
// it via comfyCloudServiceEndpoint (gpu → {serverName: spawnerUrl}) and walks
// that GPU's servers IN ORDER — first spawner answering a usable 302 redirect
// wins, failures fall through, and an exhausted list answers HTTP 503 with
// the per-server attempts trail. The spawned pod is only returned once its
// ONE persistent websocket is connected and held (pod-socket.ts).
//
// The websocket is replaced with a deterministic native ComfyUI fake and
// fetch is stubbed, so no real spawner or pod is contacted.
// =============================================================================

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    openBehavior: 'open' as 'open' | 'refused'
}));

// The fake opens on the next microtask, or refuses the connection
// (error + close events, like a TCP-level refusal) per testState.
vi.mock('undici', () => {
    class FakeWebSocket extends EventTarget {
        static readonly CONNECTING = 0;
        static readonly OPEN = 1;
        static readonly CLOSING = 2;
        static readonly CLOSED = 3;
        readonly url: string;
        readyState = FakeWebSocket.CONNECTING;

        constructor(url: string) {
            super();
            this.url = url;
            queueMicrotask(() => {
                if (this.readyState !== FakeWebSocket.CONNECTING) return;
                if (testState.openBehavior === 'refused') {
                    this.readyState = FakeWebSocket.CLOSED;
                    this.dispatchEvent(new Event('error'));
                    this.dispatchEvent(new Event('close'));
                    return;
                }
                this.readyState = FakeWebSocket.OPEN;
                this.dispatchEvent(new Event('open'));
            });
        }

        send(_data: string): void {}
        close(): void {
            this.readyState = FakeWebSocket.CLOSED;
        }
    }

    return {
        WebSocket: FakeWebSocket,
        Agent: class FakeAgent { constructor(_opts?: any) {} },
        ping: () => undefined
    };
});

import { createCloudPod, listCloudPods, requestSpawn, spawnFromCandidates } from './cloud';
import { closeAllPodSockets } from './pod-socket';

// Derive the 4090 spawner URL from the live registry so the test never
// breaks when secrets rotate — the same source cloud.ts resolves at runtime.
import { comfyCloudServiceEndpoint } from '@runtime/secret/private';
const registry = comfyCloudServiceEndpoint as Record<string, Record<string, string>>;
const SPAWNER_4090 = Object.values(registry['4090'])[0];
const POD_URL = 'https://pod-a.example';

function context() {
    return { req: { header: () => ({}) } } as any;
}

function parameters(body: Record<string, unknown>) {
    return { path: {}, query: {}, body } as any;
}

beforeEach(() => {
    testState.openBehavior = 'open';
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    // Release every persistent pod socket so no registry state/heartbeat
    // leaks between tests.
    closeAllPodSockets();
    vi.unstubAllGlobals();
});

describe('requestSpawn', () => {
    it('GETs the spawner and returns the 302 Location', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(null, { status: 302, headers: { location: POD_URL } })
        );

        await expect(requestSpawn(SPAWNER_4090)).resolves.toBe(POD_URL);
        // URL normalization adds the trailing slash to the bare host.
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${SPAWNER_4090}/`);
        expect((vi.mocked(fetch).mock.calls[0][1] as RequestInit).redirect).toBe('manual');
    });

    it('appends the pod name as ?name=', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(null, { status: 302, headers: { location: POD_URL } })
        );

        await requestSpawn(SPAWNER_4090, 'my-pod');
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${SPAWNER_4090}/?name=my-pod`);
    });

    it('throws on a non-redirect status, including the body hint', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('out of capacity', { status: 500 }));

        await expect(requestSpawn(SPAWNER_4090)).rejects.toThrow(
            'Spawner returned HTTP 500 (expected 302 redirect): out of capacity'
        );
    });

    it('throws on a redirect without a Location header', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 302 }));

        await expect(requestSpawn(SPAWNER_4090)).rejects.toThrow('302 but no Location header');
    });

    it('throws on an invalid spawner URL', async () => {
        await expect(requestSpawn('not a url')).rejects.toThrow('Invalid spawner URL: not a url');
    });
});

describe('spawnFromCandidates', () => {
    const candidates = [
        { server: 'first', url: 'https://spawner-1.example/spawn' },
        { server: 'second', url: 'https://spawner-2.example/spawn' }
    ];

    it('uses the first server when it answers a 302', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(null, { status: 302, headers: { location: POD_URL } })
        );

        const result = await spawnFromCandidates(candidates);
        expect(result).toEqual({ location: POD_URL, server: 'first', attempts: [] });
        // The fallback server is never contacted.
        expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).toEqual(['https://spawner-1.example/spawn']);
    });

    it('falls through to the next server when the first fails, recording the attempt', async () => {
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url === 'https://spawner-1.example/spawn') throw new Error('connect ECONNREFUSED');
            return new Response(null, { status: 302, headers: { location: POD_URL } });
        });

        const result = await spawnFromCandidates(candidates);
        expect(result.location).toBe(POD_URL);
        expect(result.server).toBe('second');
        expect(result.attempts).toEqual([{ server: 'first', error: 'connect ECONNREFUSED' }]);
        expect(vi.mocked(fetch).mock.calls.map((c) => c[0])).toEqual([
            'https://spawner-1.example/spawn',
            'https://spawner-2.example/spawn'
        ]);
    });

    it('returns location=null with the full attempts trail once the list is exhausted', async () => {
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url === 'https://spawner-1.example/spawn') {
                return new Response('overloaded', { status: 503 });
            }
            throw new Error('socket hang up');
        });

        const result = await spawnFromCandidates(candidates);
        expect(result.location).toBeNull();
        expect(result.server).toBeUndefined();
        expect(result.attempts).toEqual([
            { server: 'first', error: 'Spawner returned HTTP 503 (expected 302 redirect): overloaded' },
            { server: 'second', error: 'socket hang up' }
        ]);
    });
});

describe('POST /v1/comfy/cloud — gpu selection', () => {
    const STATUS_DOCUMENT = { health: { healthy: true }, models_dir: '', models: {} };

    it('rejects a create request without a gpu, listing the available GPUs', async () => {
        const result = await createCloudPod(context(), parameters({}), {});
        expect(result.status).toBe(400);
        expect(result.response).toMatchObject({ available_gpus: ['4090', '6000'] });
        expect(String((result.response as any).error)).toContain('Missing gpu');
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('rejects an unknown gpu, listing the available GPUs', async () => {
        const result = await createCloudPod(context(), parameters({ gpu: 'A100' }), {});
        expect(result.status).toBe(400);
        expect(result.response).toMatchObject({
            error: 'Unknown gpu: A100',
            available_gpus: ['4090', '6000']
        });
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it("spawns a 4090 pod through the 'lancer' spawner and echoes gpu + spawner", async () => {
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url === `${SPAWNER_4090}/`) {
                return new Response(null, { status: 302, headers: { location: POD_URL } });
            }
            if (url === `${POD_URL}/`) {
                return new Response('<!doctype html><html>ComfyUI</html>', {
                    status: 200,
                    headers: { 'content-type': 'text/html' }
                });
            }
            if (url === `${POD_URL}/system_stats`) {
                return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const result = await createCloudPod(context(), parameters({ gpu: '4090' }), {});
        expect(result.status).toBe(200);
        expect(result.response).toMatchObject({
            pod_url: POD_URL,
            gpu: '4090',
            spawner: 'lancer',
            health: { healthy: true },
            models_dir: ''
        });
        // First fetch is the spawner; the pod probe follows.
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${SPAWNER_4090}/`);
    });

    it('passes the pod name through to the spawner', async () => {
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url.startsWith(SPAWNER_4090)) {
                return new Response(null, { status: 302, headers: { location: POD_URL } });
            }
            return new Response(JSON.stringify(STATUS_DOCUMENT), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        });

        const result = await createCloudPod(context(), parameters({ gpu: '4090', name: 'dev machine' }), {});
        expect(result.status).toBe(200);
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${SPAWNER_4090}/?name=dev+machine`);
    });

    it('answers 503 with the attempts trail when every spawner for the GPU fails', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

        // 6000 has one active registry candidate; any missing/empty registry
        // entry would be rejected as unknown.
        const result = await createCloudPod(context(), parameters({ gpu: '6000' }), {});
        expect(result.status).toBe(503);
        expect(result.response).toEqual({
            error: 'No server available to spawn gpu=6000 — every spawner failed',
            attempts: [{ server: 'devin', error: 'connect ECONNREFUSED' }]
        });
    });

    it('honours the spawnerUrl override as a single-candidate list', async () => {
        const spawnLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const override = 'https://ops-spawner.example/spawn';
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url === override) {
                return new Response(null, { status: 302, headers: { location: POD_URL } });
            }
            return new Response(JSON.stringify(STATUS_DOCUMENT), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        });

        const result = await createCloudPod(context(), parameters({}), { spawnerUrl: override });
        expect(result.status).toBe(200);
        expect(result.response).toMatchObject({ pod_url: POD_URL, spawner: 'override' });
        // Only the clickable pod URL is logged; health/system_stats remain API
        // response data and are never serialized into the success log.
        expect(spawnLog.mock.calls).toEqual([
            ['[cloud] spawn status success:', POD_URL]
        ]);
        spawnLog.mockRestore();
    });

    it('answers 502 and registers nothing when the fresh pod refuses its persistent websocket', async () => {
        testState.openBehavior = 'refused';
        vi.mocked(fetch).mockResolvedValue(
            new Response(null, { status: 302, headers: { location: POD_URL } })
        );

        const result = await createCloudPod(context(), parameters({ gpu: '4090' }), {});
        expect(result.status).toBe(502);
        expect(String((result.response as any).error)).toContain('refused the direct ComfyUI websocket');
        // The refused pod is NOT handed out — the registry stays empty.
        expect((await listCloudPods(context(), parameters({}), {})).response).toEqual({
            available_gpus: ['4090', '6000'],
            pods: []
        });
    });
});

describe('GET /v1/comfy/cloud', () => {
    it('returns an empty list before any pod was spawned', async () => {
        const result = await listCloudPods(context(), parameters({}), {});
        expect(result).toEqual({
            status: 200,
            response: { available_gpus: ['4090', '6000'], pods: [] }
        });
    });

    it('lists the spawned pods as active with zero in-flight prompts', async () => {
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url.startsWith(SPAWNER_4090)) {
                return new Response(null, { status: 302, headers: { location: POD_URL } });
            }
            return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
        });
        await createCloudPod(context(), parameters({ gpu: '4090' }), {});

        const result = await listCloudPods(context(), parameters({}), {});
        expect(result.status).toBe(200);
        expect(result.response).toEqual({
            available_gpus: ['4090', '6000'],
            pods: [{
                pod_url: `${POD_URL}/`,
                gpu: '4090',
                name: undefined,
                client_id: expect.any(String),
                active: true,
                prompts: 0,
                queue: [],
                connectedAt: expect.any(String)
            }]
        });
    });
});
