// =============================================================================
// GPU-keyed spawner selection tests (endpoints/cloud/cloud.ts).
//
// POST /v1/comfy/cloud create mode now requires a `gpu` key; the server
// resolves it via comfyCloudServiceEndpoint (gpu → {serverName: spawnerUrl})
// and walks that GPU's servers IN ORDER — first spawner answering a usable
// 302 redirect wins, failures fall through, and an exhausted list answers
// HTTP 503 with the per-server attempts trail.
//
// The websocket is replaced with a deterministic native ComfyUI fake and
// fetch is stubbed, so no real spawner or pod is contacted.
// =============================================================================

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Every websocket handshake completes → spawned pods use native ComfyUI.
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
                this.readyState = FakeWebSocket.OPEN;
                this.dispatchEvent(new Event('open'));
            });
        }

        send(_data: string): void {}
        close(): void {
            this.readyState = FakeWebSocket.CLOSED;
        }
    }

    return { WebSocket: FakeWebSocket, Agent: class FakeAgent { constructor(_opts?: any) {} } };
});

import { createCloudPod, requestSpawn, spawnFromCandidates } from './cloud';

// The real registry endpoints (runtime/secret/private/modal/comfy.ts) —
// the 4090 GPU currently has exactly one spawner server named "lancer".
const SPAWNER_4090 = 'https://50f90002-77b2-4668-96ef-5a5e1bcd6dbc-8000.app.beam.cloud';
const POD_URL = 'https://pod-a.example';

function context() {
    return { req: { header: () => ({}) } } as any;
}

function parameters(body: Record<string, unknown>) {
    return { path: {}, query: {}, body } as any;
}

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
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
        expect(result.response).toMatchObject({ available_gpus: ['4090', 'RTX6000', 'B300'] });
        expect(String((result.response as any).error)).toContain('Missing gpu');
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('rejects an unknown gpu, listing the available GPUs', async () => {
        const result = await createCloudPod(context(), parameters({ gpu: 'A100' }), {});
        expect(result.status).toBe(400);
        expect(result.response).toMatchObject({
            error: 'Unknown gpu: A100',
            available_gpus: ['4090', 'RTX6000', 'B300']
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

        const result = await createCloudPod(context(), parameters({ gpu: 'B300' }), {});
        expect(result.status).toBe(503);
        expect(result.response).toEqual({
            error: 'No server available to spawn gpu=B300 — every spawner failed',
            attempts: [{ server: 'brianJohnson', error: 'connect ECONNREFUSED' }]
        });
    });

    it('honours the spawnerUrl override as a single-candidate list', async () => {
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
    });
});
