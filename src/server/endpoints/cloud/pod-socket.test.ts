// =============================================================================
// Persistent pod websocket registry tests (endpoints/cloud/pod-socket.ts) and
// the registry-backed cloud / cloud-prompt endpoint wiring.
//
// ONE websocket per cloud pod lives in server memory forever (until the
// cloud server terminates it); every prompt rides that socket and events are
// demultiplexed by prompt_id. The websocket is replaced with a deterministic
// EventTarget fake and fetch is stubbed, so no real ComfyUI server is
// contacted.
// =============================================================================

// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    // randomUUIDs consumed in order (pod client id, then subscriber ids).
    uuidValues: [] as string[],
    sockets: [] as any[],
    openBehavior: 'open' as 'open' | 'refused',
    pingBehavior: 'ok' as 'ok' | 'throw'
}));

// Deterministic client ids for the pod sockets / prompt subscribers.
vi.mock('node:crypto', () => ({
    randomUUID: () => testState.uuidValues.shift() ?? '99999999-9999-9999-9999-999999999999'
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
            testState.sockets.push(this);
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
            if (this.readyState === FakeWebSocket.CLOSED) return;
            this.readyState = FakeWebSocket.CLOSED;
            this.dispatchEvent(new Event('close'));
        }

        emitMessage(data: unknown): void {
            this.dispatchEvent(new MessageEvent('message', { data }));
        }
    }

    return {
        WebSocket: FakeWebSocket,
        Agent: class FakeAgent { constructor(_opts?: any) {} },
        ping: () => {
            if (testState.pingBehavior === 'throw') throw new Error('ping failed');
        }
    };
});

import { createCloudPod, listCloudPods } from './cloud';
import { cloudPrompt } from './cloud-prompt';
import {
    closeAllPodSockets,
    connectPodSocket,
    getPodSocket,
    listPodSockets,
    POD_WS_HEARTBEAT_MS,
    subscribePodPrompt,
    submitPodPrompt
} from './pod-socket';
import { readGenerationFile, writeGenerationFile } from '../workflows/generation-store';

const CLIENT_UUID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '11111111111111111111111111111111';
const SUB_UUID = '22222222-2222-2222-2222-222222222222';
const SUB2_UUID = '33333333-3333-3333-3333-333333333333';
const POD_URL = 'https://pod-a.example';

function context() {
    // cloudPrompt reads req.header() as the full incoming header map.
    return { req: { header: () => ({}) } } as any;
}

function parameters(body: Record<string, unknown>) {
    return { path: {}, query: {}, body } as any;
}

/** Build a ComfyUI binary preview frame: 8-byte BE header + payload. */
function previewFrame(kind: number, payload: number[]): Uint8Array {
    const frame = new Uint8Array(8 + payload.length);
    new DataView(frame.buffer).setUint32(0, kind, false);
    frame.set(payload, 8);
    return frame;
}

/** Drain a Response's NDJSON body into parsed event lines. */
async function readStreamLines(response: Response): Promise<any[]> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const lines: any[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
            const trimmed = part.trim();
            if (trimmed) lines.push(JSON.parse(trimmed));
        }
    }
    return lines;
}

/** Flush the registry's async message chain / subscribe flush microtasks. */
async function flushSocketDelivery(): Promise<void> {
    // Several chained promises sit between each socket message and its
    // delivery (EventTarget dispatch → chain link → routing), so macrotask
    // turns are used — each one drains ALL pending microtasks.
    for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
}

beforeEach(() => {
    testState.uuidValues = [CLIENT_UUID, SUB_UUID, SUB2_UUID];
    testState.sockets.length = 0;
    testState.openBehavior = 'open';
    testState.pingBehavior = 'ok';
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    // Tear down every persistent socket so no heartbeat interval leaks.
    closeAllPodSockets();
    testState.sockets.length = 0;
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('connectPodSocket', () => {
    it('opens exactly one websocket per pod and reuses it on a second connect', async () => {
        const first = await connectPodSocket(new URL(POD_URL));
        const second = await connectPodSocket(new URL(`${POD_URL}/`));

        expect(second).toBe(first);
        // ONE websocket for the pod — the second connect created nothing.
        expect(testState.sockets).toHaveLength(1);
        expect(testState.sockets[0].url).toBe(`wss://pod-a.example/ws?clientId=${CLIENT_ID}`);
        expect(first.clientId).toBe(CLIENT_ID);
        expect(first.closed).toBe(false);
    });

    it('rejects and registers nothing when the pod refuses the websocket', async () => {
        testState.openBehavior = 'refused';
        await expect(connectPodSocket(new URL(POD_URL))).rejects.toThrow();
        expect(listPodSockets()).toEqual([]);
        expect(getPodSocket(POD_URL)).toBeNull();
    });

    it('refreshes spawn metadata when reconnecting an already-held pod', async () => {
        await connectPodSocket(new URL(POD_URL));
        await connectPodSocket(new URL(POD_URL), { gpu: '4090', name: 'dev pod' });

        expect(listPodSockets()).toEqual([
            {
                pod_url: `${POD_URL}/`,
                gpu: '4090',
                name: 'dev pod',
                client_id: CLIENT_ID,
                active: true,
                prompts: 0,
                connectedAt: expect.any(String)
            }
        ]);
    });
});

describe('getPodSocket / listPodSockets', () => {
    it('returns null for unknown pods and reports prompt counts from subscribers + pending submissions', async () => {
        expect(getPodSocket('https://unknown.example')).toBeNull();
        expect(getPodSocket('not a url')).toBeNull();

        const connection = await connectPodSocket(new URL(POD_URL));
        expect(getPodSocket(POD_URL)).toBe(connection);

        // A submitted-but-not-yet-subscribed prompt counts as pending.
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ prompt_id: 'prompt-1', number: 1, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );
        await submitPodPrompt(connection, { promptPayload: { prompt: {} } });
        expect(listPodSockets()[0].prompts).toBe(1);

        // Subscribing transfers the pending count into a live subscriber.
        const unsubscribe = subscribePodPrompt(connection, { promptId: 'prompt-1', onEvent: () => undefined });
        expect(listPodSockets()[0].prompts).toBe(1);
        unsubscribe();
        expect(listPodSockets()[0].prompts).toBe(0);
    });
});

describe('submitPodPrompt', () => {
    it("POSTs /prompt bound to the pod's shared client_id and returns the ack", async () => {
        const connection = await connectPodSocket(new URL(POD_URL));
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ prompt_id: 'prompt-001', number: 5, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const { response, ack } = await submitPodPrompt(connection, {
            promptPayload: { prompt: { '3': { class_type: 'KSampler', inputs: {} } } }
        });

        expect(response.status).toBe(200);
        expect(ack).toEqual({ prompt_id: 'prompt-001', number: 5, node_errors: {} });
        const [input, init] = vi.mocked(fetch).mock.calls[0] as any[];
        expect(String(input)).toBe(`${POD_URL}/prompt`);
        expect(init.method).toBe('POST');
        // The socket/prompt client_id pairing is what routes this prompt's
        // events to the pod's ONE persistent socket.
        expect(JSON.parse(init.body).client_id).toBe(CLIENT_ID);
        // No additional websocket was opened for the submission.
        expect(testState.sockets).toHaveLength(1);
    });

    it('relays the native error response when POST /prompt is rejected', async () => {
        const connection = await connectPodSocket(new URL(POD_URL));
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ error: 'Prompt has no outputs' }), {
                status: 400,
                headers: { 'content-type': 'application/json' }
            })
        );

        const { response, ack } = await submitPodPrompt(connection, { promptPayload: { prompt: {} } });
        expect(response.status).toBe(400);
        expect(ack).toBeNull();
        await expect(response.json()).resolves.toEqual({ error: 'Prompt has no outputs' });
        // The failed submission released its pending count.
        expect(listPodSockets()[0].prompts).toBe(0);
    });
});

describe('event demultiplexing (subscribePodPrompt)', () => {
    it('routes prompt_id events to their subscriber only and broadcasts unattributed events to everyone', async () => {
        const connection = await connectPodSocket(new URL(POD_URL));
        const socket = testState.sockets[0];
        const seenA: any[] = [];
        const seenB: any[] = [];
        subscribePodPrompt(connection, { promptId: 'prompt-a', onEvent: (e) => seenA.push(e) });
        subscribePodPrompt(connection, { promptId: 'prompt-b', onEvent: (e) => seenB.push(e) });

        socket.emitMessage(JSON.stringify({ type: 'progress', data: { value: 1, max: 20, prompt_id: 'prompt-a' } }));
        socket.emitMessage(JSON.stringify({ type: 'progress', data: { value: 3, max: 20, prompt_id: 'prompt-b' } }));
        // A third job's event matches NO subscriber — buffered, not delivered.
        socket.emitMessage(JSON.stringify({ type: 'progress', data: { value: 9, max: 20, prompt_id: 'prompt-x' } }));
        socket.emitMessage(JSON.stringify({ type: 'status', data: { status: { queue_running: [] } } }));
        await flushSocketDelivery();

        expect(seenA).toEqual([
            { type: 'progress', data: { value: 1, max: 20, prompt_id: 'prompt-a' } },
            { type: 'status', data: { status: { queue_running: [] } } }
        ]);
        expect(seenB).toEqual([
            { type: 'progress', data: { value: 3, max: 20, prompt_id: 'prompt-b' } },
            { type: 'status', data: { status: { queue_running: [] } } }
        ]);
    });

    it('flushes events buffered for a prompt_id before its subscriber registered', async () => {
        const connection = await connectPodSocket(new URL(POD_URL));
        const socket = testState.sockets[0];

        // Execution outran the HTTP ack → subscribe path: buffered.
        socket.emitMessage(JSON.stringify({ type: 'executing', data: { node: '3', prompt_id: 'prompt-late' } }));
        socket.emitMessage(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'prompt-late' } }));
        await flushSocketDelivery();

        const seen: any[] = [];
        subscribePodPrompt(connection, { promptId: 'prompt-late', onEvent: (e) => seen.push(e) });
        await flushSocketDelivery();

        expect(seen).toEqual([
            { type: 'executing', data: { node: '3', prompt_id: 'prompt-late' } },
            { type: 'execution_success', data: { prompt_id: 'prompt-late' } }
        ]);
    });

    it('attributes binary preview frames to the last executing node+prompt and routes them there', async () => {
        const connection = await connectPodSocket(new URL(POD_URL));
        const socket = testState.sockets[0];
        const seenA: any[] = [];
        const seenB: any[] = [];
        subscribePodPrompt(connection, { promptId: 'prompt-a', onEvent: (e) => seenA.push(e) });
        subscribePodPrompt(connection, { promptId: 'prompt-b', onEvent: (e) => seenB.push(e) });

        socket.emitMessage(JSON.stringify({ type: 'executing', data: { node: '9', prompt_id: 'prompt-a' } }));
        // PNG preview frame — carries no node/prompt reference on the wire.
        socket.emitMessage(previewFrame(2, [137, 80, 78, 71]));
        await flushSocketDelivery();

        const expectedImage = `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString('base64')}`;
        expect(seenA).toEqual([
            { type: 'executing', data: { node: '9', prompt_id: 'prompt-a' } },
            { type: 'imagepreview.update', data: { node_id: '9', prompt_id: 'prompt-a', image: expectedImage } }
        ]);
        // The other prompt's subscriber never saw the preview.
        expect(seenB).toEqual([]);
    });
});

describe('pod termination', () => {
    it('fails every in-flight prompt with prompt_error and deregisters on remote close — never reconnects', async () => {
        const connection = await connectPodSocket(new URL(POD_URL));
        const seenA: any[] = [];
        const seenB: any[] = [];
        subscribePodPrompt(connection, { promptId: 'prompt-a', onEvent: (e) => seenA.push(e) });
        subscribePodPrompt(connection, { promptId: 'prompt-b', onEvent: (e) => seenB.push(e) });
        // The death must NOT trigger any /history probe or other pod call.
        vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200 }));

        testState.sockets[0].close();
        await flushSocketDelivery();

        // Pods are designed to terminate when idle and never restart — the
        // death is terminal, IMMEDIATE, and no new socket is ever opened.
        const terminal = { type: 'prompt_error', data: { error: 'ComfyUI websocket closed by the cloud server' } };
        expect(seenA).toEqual([terminal]);
        expect(seenB).toEqual([terminal]);
        expect(testState.sockets).toHaveLength(1);
        expect(getPodSocket(POD_URL)).toBeNull();
        expect(listPodSockets()).toEqual([]);
        expect(vi.mocked(fetch).mock.calls).toEqual([]);
    });

    it('a late event from the dead socket cannot revive or double-terminate the pod', async () => {
        const connection = await connectPodSocket(new URL(POD_URL));
        const seen: any[] = [];
        subscribePodPrompt(connection, { promptId: 'prompt-a', onEvent: (e) => seen.push(e) });

        testState.sockets[0].close();
        await flushSocketDelivery();
        const terminal = { type: 'prompt_error', data: { error: 'ComfyUI websocket closed by the cloud server' } };
        expect(seen).toEqual([terminal]);

        // Error/close signals after termination are inert.
        testState.sockets[0].dispatchEvent(new Event('error'));
        testState.sockets[0].dispatchEvent(new Event('close'));
        await flushSocketDelivery();
        expect(seen).toEqual([terminal]);
        expect(testState.sockets).toHaveLength(1);
    });

    it('terminates the pod when a heartbeat ping write fails', async () => {
        vi.useFakeTimers();
        testState.pingBehavior = 'throw';
        const connection = await connectPodSocket(new URL(POD_URL));
        const seen: any[] = [];
        subscribePodPrompt(connection, { promptId: 'prompt-a', onEvent: (e) => seen.push(e) });

        await vi.advanceTimersByTimeAsync(POD_WS_HEARTBEAT_MS);

        expect(seen).toEqual([
            { type: 'prompt_error', data: { error: 'ComfyUI websocket stopped responding: ping failed' } }
        ]);
        // No reconnect socket was attempted for the write-failed corpse.
        expect(testState.sockets).toHaveLength(1);
        expect(getPodSocket(POD_URL)).toBeNull();
    });

    it('keeps an idle pod connected forever — no response-silence watchdog', async () => {
        vi.useFakeTimers();
        await connectPodSocket(new URL(POD_URL));

        // Long past the old per-prompt 300s response watchdog: pongs are not
        // required — only a failed ping write or remote close terminates.
        await vi.advanceTimersByTimeAsync(600_000);

        expect(getPodSocket(POD_URL)).not.toBeNull();
        expect(listPodSockets()[0].active).toBe(true);
    });
});

describe('POST /v1/comfy/cloud — persistent socket lifecycle', () => {
    const STATUS_DOCUMENT = { health: { healthy: true }, models_dir: '', models: {} };

    it('status mode adopts an unknown pod by holding its websocket', async () => {
        const systemStats = { system: { os: 'linux', comfyui_version: '0.3.40' }, devices: [] };
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url === `${POD_URL}/`) return new Response('<!doctype html><html>ComfyUI</html>', { status: 200 });
            if (url === `${POD_URL}/system_stats`) {
                return new Response(JSON.stringify(systemStats), { status: 200, headers: { 'content-type': 'application/json' } });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const result = await createCloudPod(context(), parameters({ pod_url: POD_URL }), {});
        expect(result.status).toBe(200);
        expect(result.response).toMatchObject({
            health: { healthy: true, system_stats: systemStats },
            models_dir: '',
            models: {}
        });
        // The pod is now registered — held forever until the socket dies.
        expect(testState.sockets).toHaveLength(1);
        expect(getPodSocket(POD_URL)).not.toBeNull();
    });

    it('status mode reuses the already-registered socket instead of opening another', async () => {
        await connectPodSocket(new URL(POD_URL));
        vi.mocked(fetch).mockRejectedValue(new Error('socket hang up'));

        const result = await createCloudPod(context(), parameters({ pod_url: POD_URL }), {});
        expect(result.status).toBe(200);
        expect(result.response).toMatchObject({
            // The held socket is authoritative even when HTTP probes fail.
            health: { healthy: true, checked: { http_ok: false, websocket: true } }
        });
        // Still ONE websocket for the pod.
        expect(testState.sockets).toHaveLength(1);
    });

    it('status mode answers 502 when the pod refuses the websocket', async () => {
        testState.openBehavior = 'refused';
        const result = await createCloudPod(context(), parameters({ pod_url: POD_URL }), {});
        expect(result.status).toBe(502);
        expect(String((result.response as any).error)).toContain('refused the direct ComfyUI websocket');
        expect(listPodSockets()).toEqual([]);
    });

    it('status mode rejects an invalid pod_url', async () => {
        const result = await createCloudPod(context(), parameters({ pod_url: 'not a url' }), {});
        expect(result.status).toBe(400);
    });

    it('create mode blocks until the spawned pod holds its websocket', async () => {
        const SPAWNER = 'https://spawner.example/spawn';
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url === SPAWNER) {
                return new Response(null, { status: 302, headers: { location: POD_URL } });
            }
            return new Response(JSON.stringify(STATUS_DOCUMENT), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        });

        const result = await createCloudPod(context(), parameters({ gpu: '4090' }), { spawnerUrl: SPAWNER });
        expect(result.status).toBe(200);
        expect(result.response).toMatchObject({ pod_url: POD_URL, gpu: '4090', spawner: 'override' });
        // The returned pod already holds its ONE persistent socket.
        const connection = getPodSocket(POD_URL);
        expect(connection).not.toBeNull();
        expect(connection!.gpu).toBe('4090');
    });

    it('create mode answers 502 and registers nothing when the fresh pod refuses the websocket', async () => {
        testState.openBehavior = 'refused';
        const SPAWNER = 'https://spawner.example/spawn';
        vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 302, headers: { location: POD_URL } }));

        const result = await createCloudPod(context(), parameters({ gpu: '4090' }), { spawnerUrl: SPAWNER });
        expect(result.status).toBe(502);
        expect(String((result.response as any).error)).toContain('refused the direct ComfyUI websocket');
        expect(listPodSockets()).toEqual([]);
    });

    it('GET /v1/comfy/cloud lists the active pods with their prompt counts', async () => {
        await connectPodSocket(new URL(POD_URL), { gpu: '4090' });
        subscribePodPrompt(getPodSocket(POD_URL)!, { promptId: 'prompt-1', onEvent: () => undefined });

        const result = await listCloudPods(context(), parameters({}), {});
        expect(result.status).toBe(200);
        expect(result.response).toEqual({
            pods: [
                {
                    pod_url: `${POD_URL}/`,
                    gpu: '4090',
                    name: undefined,
                    client_id: CLIENT_ID,
                    active: true,
                    prompts: 1,
                    connectedAt: expect.any(String)
                }
            ]
        });
    });
});

describe('POST /v1/comfy/cloud/prompt — shared-socket transport', () => {
    it('rejects prompt submission when the pod is not registry-connected', async () => {
        const result = await cloudPrompt(context(), parameters({
            pod_url: POD_URL,
            prompt: { '3': { class_type: 'KSampler', inputs: {} } }
        }), {});

        expect(result.status).toBe(502);
        expect(String((result.response as any).error)).toContain('Pod is not connected');
        // No pod contact was even attempted.
        expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    });

    it('streams prompt events off the ONE shared socket (direct mode)', async () => {
        await connectPodSocket(new URL(POD_URL));
        vi.mocked(fetch).mockImplementation(async (input: any, init: any) => {
            const url = String(input);
            if (url === `${POD_URL}/prompt`) {
                expect(JSON.parse(init.body).client_id).toBe(CLIENT_ID);
                return new Response(JSON.stringify({ prompt_id: 'prompt-405', number: 1, node_errors: {} }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const result = await cloudPrompt(context(), parameters({
            pod_url: POD_URL,
            prompt: { '3': { class_type: 'KSampler', inputs: {} } },
            client_id: 'ignored-legacy-client-id'
        }), {});

        expect(result.status).toBe(200);
        // Still exactly ONE websocket on the pod — the stream taps it.
        expect(testState.sockets).toHaveLength(1);

        const socket = testState.sockets[0];
        socket.emitMessage(JSON.stringify({ type: 'executing', data: { node: '3', prompt_id: 'prompt-405' } }));
        socket.emitMessage(previewFrame(2, [137, 80, 78, 71]));
        socket.emitMessage(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'prompt-405' } }));

        const lines = await readStreamLines((result as any).raw as Response);
        expect(lines).toEqual([
            { type: 'prompt_queued', data: { prompt_id: 'prompt-405', number: 1, node_errors: {} } },
            { type: 'executing', data: { node: '3', prompt_id: 'prompt-405' } },
            {
                type: 'imagepreview.update',
                data: {
                    node_id: '3',
                    prompt_id: 'prompt-405',
                    image: `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString('base64')}`
                }
            },
            { type: 'execution_success', data: { prompt_id: 'prompt-405' } },
            { type: 'prompt_done', data: {} }
        ]);
    });

    it('ends the direct stream with prompt_error when the pod socket dies mid-run', async () => {
        await connectPodSocket(new URL(POD_URL));
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ prompt_id: 'prompt-close', number: 1, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const result = await cloudPrompt(context(), parameters({
            pod_url: POD_URL,
            prompt: { '3': { class_type: 'KSampler', inputs: {} } }
        }), {});
        testState.sockets[0].close();

        // The pod is dead forever — the failure is terminal, immediate, and
        // no reconnect socket is ever attempted.
        await expect(readStreamLines((result as any).raw as Response)).resolves.toEqual([
            { type: 'prompt_queued', data: { prompt_id: 'prompt-close', number: 1, node_errors: {} } },
            { type: 'prompt_error', data: { error: 'ComfyUI websocket closed by the cloud server' } }
        ]);
        expect(testState.sockets).toHaveLength(1);
    });

    it('processes a run into the workflow generation json + per-prompt log (server-side mode)', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pod-socket-'));
        try {
            const workflowId = 'wf-1';
            const generationId = 'gen-1';
            // writeGenerationFile does not create the folder (the real
            // caller, POST .../generate, does) — build it first.
            await fs.mkdir(path.join(root, 'comfy-workflows', workflowId, 'generation'), { recursive: true });
            await writeGenerationFile(root, workflowId, generationId, {
                id: generationId,
                status: 'pending',
                createdDate: '2026-08-05T10:00:00.000Z',
                completedDate: null,
                generatedTime: null,
                error: null,
                prompt: { '3': { class_type: 'KSampler', inputs: {} } },
                result: []
            });

            await connectPodSocket(new URL(POD_URL));
            vi.mocked(fetch).mockResolvedValue(
                new Response(JSON.stringify({ prompt_id: 'prompt-405', number: 1, node_errors: {} }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                })
            );

            const result = await cloudPrompt(context(), parameters({
                pod_url: POD_URL,
                prompt: { '3': { class_type: 'KSampler', inputs: {} } },
                workflow_id: workflowId,
                generation_id: generationId
            }), { root });

            expect(result.status).toBe(202);
            expect(result.response).toEqual({
                accepted: true,
                workflow_id: workflowId,
                generation_id: generationId,
                client_id: CLIENT_ID,
                prompt_id: 'prompt-405'
            });
            // Still ONE websocket — the generation is processed by matching
            // prompt_id off the pod's shared socket.
            expect(testState.sockets).toHaveLength(1);

            const socket = testState.sockets[0];
            socket.emitMessage(JSON.stringify({ type: 'executing', data: { node: '3', prompt_id: 'prompt-405' } }));
            socket.emitMessage(previewFrame(2, [137, 80, 78, 71]));
            socket.emitMessage(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'prompt-405' } }));

            // The background finalizer is async IO — poll until it settles.
            const deadline = Date.now() + 5000;
            let entry = await readGenerationFile(root, workflowId, generationId);
            while (entry?.status !== 'completed' && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 25));
                entry = await readGenerationFile(root, workflowId, generationId);
            }

            expect({
                ...entry,
                completedDate: expect.any(String),
                generatedTime: expect.any(String)
            }).toEqual({
                id: generationId,
                status: 'completed',
                createdDate: '2026-08-05T10:00:00.000Z',
                completedDate: expect.any(String),
                generatedTime: expect.any(String),
                error: null,
                prompt: { '3': { class_type: 'KSampler', inputs: {} } },
                // The preview was persisted to an asset file; only the
                // small file: reference stays in the json.
                result: [{ type: 'image', url: 'file:0.png', mimeType: 'image/png', size: 4, nodeId: '3' }]
            });

            // One log per prompt: every routed event was traced in order.
            const logText = await fs.readFile(
                path.join(root, 'comfy-workflows', workflowId, 'generation', `${generationId}.log`),
                'utf-8'
            );
            const logLines = logText
                .trimEnd()
                .split('\n')
                .map((line) => line.replace(/^\[[^\]]+\] /, '').replace(/in \d+\.\d+s/, 'in <t>s'));
            expect(logLines).toEqual([
                `Generation started — submitting to ${POD_URL}/ (ComfyUI shared websocket, client_id: ${CLIENT_ID}, prompt_id: prompt-405)`,
                'Event: executing node=3 prompt_id=prompt-405',
                'Event: imagepreview.update node_id=3 prompt_id=prompt-405 image=<30 chars>',
                'Captured preview image from node 3 (image/png, 4 bytes)',
                'Event: execution_success prompt_id=prompt-405',
                'Persisted result payload(s) to asset files under generation/gen-1/',
                'Generation COMPLETED in <t>s — 3 event(s), 1 result(s)'
            ]);

            // The prompt no longer counts against the pod once settled.
            expect(listPodSockets()[0].prompts).toBe(0);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    it('fails the generation from a validation-error ack without any socket event', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pod-socket-'));
        try {
            const workflowId = 'wf-1';
            const generationId = 'gen-2';
            await fs.mkdir(path.join(root, 'comfy-workflows', workflowId, 'generation'), { recursive: true });
            await writeGenerationFile(root, workflowId, generationId, {
                id: generationId,
                status: 'pending',
                createdDate: '2026-08-05T10:00:00.000Z',
                completedDate: null,
                generatedTime: null,
                error: null,
                prompt: {},
                result: []
            });

            await connectPodSocket(new URL(POD_URL));
            const nodeErrors = { '3': { errors: [{ message: 'Required input is missing' }], dependent_outputs: [] } };
            vi.mocked(fetch).mockResolvedValue(
                new Response(JSON.stringify({ prompt_id: 'prompt-bad', number: 2, node_errors: nodeErrors }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                })
            );

            const result = await cloudPrompt(context(), parameters({
                pod_url: POD_URL,
                prompt: {},
                workflow_id: workflowId,
                generation_id: generationId
            }), { root });
            expect(result.status).toBe(202);

            const deadline = Date.now() + 5000;
            let entry = await readGenerationFile(root, workflowId, generationId);
            while (entry?.status !== 'failed' && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 25));
                entry = await readGenerationFile(root, workflowId, generationId);
            }

            expect(entry).toMatchObject({
                id: generationId,
                status: 'failed',
                error: `Prompt validation failed: ${JSON.stringify(nodeErrors)}`,
                result: []
            });
            // No subscriber ever existed — the prompt count released.
            expect(listPodSockets()[0].prompts).toBe(0);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
