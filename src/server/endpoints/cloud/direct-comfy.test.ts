// =============================================================================
// Direct-ComfyUI pod support tests (endpoints/cloud/direct-comfy.ts), plus
// the shape dispatch wired around the two per-shape modules: the is_direct
// detection in endpoints/cloud/cloud.ts and the stale-flag 405 self-heal in
// endpoints/cloud/cloud-prompt.ts. The sibling shape's tests live in
// ./proxy-comfy.test.ts.
//
// The websocket is replaced with a deterministic EventTarget fake and fetch
// is stubbed, so detection and the
// websocket→NDJSON translation run without a real ComfyUI server.
// =============================================================================

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
    uuidValues: [] as string[],
    sockets: [] as any[],
    openBehavior: 'open' as 'open' | 'refused',
    pingBehavior: 'ok' as 'ok' | 'throw'
}));

// Deterministic client ids for the probe / direct submissions.
vi.mock('node:crypto', () => ({
    randomUUID: () => testState.uuidValues.shift() ?? '00000000-0000-0000-0000-000000000000'
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

import { createCloudPod } from './cloud';
import { cloudPrompt } from './cloud-prompt';
import {
    DIRECT_WS_HEARTBEAT_MS,
    DIRECT_WS_RESPONSE_TIMEOUT_MS,
    probeDirectComfyUI,
    submitDirectPrompt
} from './direct-comfy';

const CLIENT_UUID = '11111111-1111-1111-1111-111111111111';
const CLIENT_ID = '11111111111111111111111111111111';
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

beforeEach(() => {
    testState.uuidValues = [CLIENT_UUID];
    testState.sockets.length = 0;
    testState.openBehavior = 'open';
    testState.pingBehavior = 'ok';
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    // Terminal prompt events close only the client stream; tests explicitly
    // close any remaining fake upstream sockets to release their watchdogs.
    for (const socket of testState.sockets) socket.close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('probeDirectComfyUI', () => {
    it('returns true when the ComfyUI websocket handshake completes', async () => {
        await expect(probeDirectComfyUI(new URL(POD_URL))).resolves.toBe(true);
        expect(testState.sockets).toHaveLength(1);
        expect(testState.sockets[0].url).toBe(`wss://pod-a.example/ws?clientId=${CLIENT_ID}`);
        // The probe closes its throwaway socket once answered.
        expect(testState.sockets[0].readyState).toBe(3);
    });

    it('returns false when the websocket connection is refused', async () => {
        testState.openBehavior = 'refused';
        await expect(probeDirectComfyUI(new URL(POD_URL))).resolves.toBe(false);
    });
});

describe('submitDirectPrompt', () => {
    it('opens the websocket under the given client_id and posts to native /prompt', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockImplementation(async (input: any, init: any) => {
            const url = String(input);
            expect(init?.method).toBe('POST');
            const payload = JSON.parse(init.body);
            // The fresh client_id is what ties this job to its socket.
            expect(payload.client_id).toBe(CLIENT_ID);
            return new Response(JSON.stringify({ prompt_id: 'prompt-001', number: 5, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        });

        const response = await submitDirectPrompt({
            podUrl: new URL(POD_URL),
            clientId: CLIENT_ID,
            promptPayload: { prompt: { '3': { class_type: 'KSampler', inputs: {} } } }
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('application/x-ndjson');
        expect(testState.sockets[0].url).toBe(`wss://pod-a.example/ws?clientId=${CLIENT_ID}`);
    });

    it('translates websocket messages into the proxy NDJSON vocabulary', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ prompt_id: 'prompt-001', number: 5, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const response = await submitDirectPrompt({
            podUrl: new URL(POD_URL),
            clientId: CLIENT_ID,
            promptPayload: { prompt: {} }
        });
        const socket = testState.sockets[0];

        socket.emitMessage(JSON.stringify({ type: 'executing', data: { node: '9', prompt_id: 'prompt-001' } }));
        // PNG preview frame — attributed to the most recent executing node.
        socket.emitMessage(previewFrame(2, [137, 80, 78, 71]));
        socket.emitMessage(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'prompt-001' } }));

        const lines = await readStreamLines(response);
        expect(lines).toEqual([
            { type: 'proxy_enqueue', data: { prompt_id: 'prompt-001', number: 5, node_errors: {} } },
            { type: 'executing', data: { node: '9', prompt_id: 'prompt-001' } },
            {
                type: 'imagepreview.update',
                data: { node_id: '9', image: `data:image/png;base64,${Buffer.from([137, 80, 78, 71]).toString('base64')}` }
            },
            { type: 'execution_success', data: { prompt_id: 'prompt-001' } },
            { type: 'proxy_done', data: {} }
        ]);
        // The proxy stream is complete, but the server keeps the native
        // websocket open for ComfyUI's final writes and its five-minute idle
        // cleanup window.
        expect(socket.readyState).toBe(1);
        socket.close();
        expect(socket.readyState).toBe(3);
    });

    it('turns a validation-failed ack (node_errors) into a terminal execution_error', async () => {
        const nodeErrors = { '3': { errors: [{ message: 'Required input is missing' }], dependent_outputs: [] } };
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ prompt_id: 'prompt-001', number: 5, node_errors: nodeErrors }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const response = await submitDirectPrompt({
            podUrl: new URL(POD_URL),
            clientId: CLIENT_ID,
            promptPayload: { prompt: {} }
        });

        const lines = await readStreamLines(response);
        expect(lines).toEqual([
            { type: 'proxy_enqueue', data: { prompt_id: 'prompt-001', number: 5, node_errors: nodeErrors } },
            {
                type: 'execution_error',
                data: {
                    prompt_id: 'prompt-001',
                    error: `Prompt validation failed: ${JSON.stringify(nodeErrors)}`,
                    node_errors: nodeErrors
                }
            }
        ]);
    });

    it('relays the pod response when POST /prompt itself fails', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ error: 'Prompt has no outputs' }), {
                status: 400,
                headers: { 'content-type': 'application/json' }
            })
        );

        const response = await submitDirectPrompt({
            podUrl: new URL(POD_URL),
            clientId: CLIENT_ID,
            promptPayload: { prompt: {} }
        });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toEqual({ error: 'Prompt has no outputs' });
        expect(testState.sockets[0].readyState).toBe(3);
    });

    it('throws when the websocket handshake is refused (not a direct pod)', async () => {
        testState.openBehavior = 'refused';
        await expect(
            submitDirectPrompt({ podUrl: new URL(POD_URL), clientId: CLIENT_ID, promptPayload: { prompt: {} } })
        ).rejects.toThrow('Failed to open ComfyUI websocket');
    });

    it('ends the NDJSON stream when the direct service closes its websocket', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ prompt_id: 'prompt-close', number: 1, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const response = await submitDirectPrompt({
            podUrl: new URL(POD_URL),
            clientId: CLIENT_ID,
            promptPayload: { prompt: {} }
        });
        testState.sockets[0].close();

        await expect(readStreamLines(response)).resolves.toEqual([
            { type: 'proxy_enqueue', data: { prompt_id: 'prompt-close', number: 1, node_errors: {} } },
            { type: 'proxy_error', data: { error: 'ComfyUI websocket closed before the prompt finished' } }
        ]);
    });

    it('ends the NDJSON stream when a websocket heartbeat write fails', async () => {
        vi.useFakeTimers();
        testState.pingBehavior = 'throw';
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ prompt_id: 'prompt-ping', number: 1, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const response = await submitDirectPrompt({
            podUrl: new URL(POD_URL),
            clientId: CLIENT_ID,
            promptPayload: { prompt: {} }
        });
        const linesPromise = readStreamLines(response);
        await vi.advanceTimersByTimeAsync(DIRECT_WS_HEARTBEAT_MS);

        await expect(linesPromise).resolves.toEqual([
            { type: 'proxy_enqueue', data: { prompt_id: 'prompt-ping', number: 1, node_errors: {} } },
            { type: 'proxy_error', data: { error: 'ComfyUI websocket stopped responding: ping failed' } }
        ]);
    });

    it('cleans up a socket that stays open without any pong or application response', async () => {
        vi.useFakeTimers();
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ prompt_id: 'prompt-timeout', number: 1, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const response = await submitDirectPrompt({
            podUrl: new URL(POD_URL),
            clientId: CLIENT_ID,
            promptPayload: { prompt: {} }
        });
        const linesPromise = readStreamLines(response);
        await vi.advanceTimersByTimeAsync(DIRECT_WS_RESPONSE_TIMEOUT_MS);

        await expect(linesPromise).resolves.toEqual([
            { type: 'proxy_enqueue', data: { prompt_id: 'prompt-timeout', number: 1, node_errors: {} } },
            {
                type: 'proxy_error',
                data: { error: `ComfyUI websocket stopped responding for ${DIRECT_WS_RESPONSE_TIMEOUT_MS / 1000}s` }
            }
        ]);
    });
});

describe('POST /v1/comfy/cloud — is_direct detection', () => {
    it('reports is_direct: false for a Tier 2 proxy pod (JSON status, websocket refused)', async () => {
        testState.openBehavior = 'refused';
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url === `${POD_URL}/`) {
                return new Response(JSON.stringify({ health: { healthy: true }, models_dir: '/models', models: {} }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const result = await createCloudPod(context(), parameters({ pod_url: POD_URL }), {});
        expect(result.status).toBe(200);
        expect(result.response).toMatchObject({
            is_direct: false,
            health: { healthy: true },
            models_dir: '/models'
        });
    });

    it('reports is_direct: true and rebuilds health for a direct ComfyUI pod (HTML at /, websocket opens)', async () => {
        const systemStats = { system: { os: 'linux', comfyui_version: '0.3.40' }, devices: [] };
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url === `${POD_URL}/`) {
                // Direct ComfyUI serves its frontend HTML here, not JSON.
                return new Response('<!doctype html><html>ComfyUI</html>', {
                    status: 200,
                    headers: { 'content-type': 'text/html' }
                });
            }
            if (url === `${POD_URL}/system_stats`) {
                return new Response(JSON.stringify(systemStats), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const result = await createCloudPod(context(), parameters({ pod_url: POD_URL }), {});
        expect(result.status).toBe(200);
        expect(result.response).toMatchObject({
            is_direct: true,
            health: { healthy: true, system_stats: systemStats },
            models_dir: '',
            models: {}
        });
    });

    it('reports healthy for a direct pod from HTTP 200 + websocket even when /system_stats is unavailable', async () => {
        vi.mocked(fetch).mockImplementation(async (input: any) => {
            const url = String(input);
            if (url === `${POD_URL}/`) {
                return new Response('<!doctype html><html>ComfyUI</html>', {
                    status: 200,
                    headers: { 'content-type': 'text/html' }
                });
            }
            if (url === `${POD_URL}/system_stats`) {
                return new Response('internal error', { status: 500 });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const result = await createCloudPod(context(), parameters({ pod_url: POD_URL }), {});
        expect(result.status).toBe(200);
        expect(result.response).toMatchObject({
            is_direct: true,
            // No system_stats at all — HTTP 200 on the base URL and the
            // completed websocket handshake are the health signals.
            health: { healthy: true, checked: { http_ok: true, websocket: true } },
            models_dir: '',
            models: {}
        });
        expect((result.response as any).health.system_stats).toBeUndefined();
    });

    it('reports a direct pod healthy on the websocket alone when the base URL probe failed', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('socket hang up'));

        const result = await createCloudPod(context(), parameters({ pod_url: POD_URL }), {});
        expect(result.status).toBe(200);
        expect(result.response).toMatchObject({
            is_direct: true,
            health: { healthy: true, checked: { http_ok: false, websocket: true } }
        });
    });

    it('returns 502 when the pod answers HTTP 200 HTML but refuses the websocket (neither proxy nor ComfyUI)', async () => {
        testState.openBehavior = 'refused';
        vi.mocked(fetch).mockResolvedValue(
            new Response('<!doctype html><html>some other web server</html>', {
                status: 200,
                headers: { 'content-type': 'text/html' }
            })
        );

        const result = await createCloudPod(context(), parameters({ pod_url: POD_URL }), {});
        expect(result.status).toBe(502);
        expect(result.response).toMatchObject({ is_direct: false });
        expect(String((result.response as any).error)).toContain('refused the ComfyUI websocket');
    });

    it('returns 502 when neither the proxy status nor the websocket answer', async () => {
        testState.openBehavior = 'refused';
        vi.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

        const result = await createCloudPod(context(), parameters({ pod_url: POD_URL }), {});
        expect(result.status).toBe(502);
        expect(result.response).toMatchObject({ is_direct: false });
        expect(String((result.response as any).error)).toContain('ECONNREFUSED');
    });

    it('rejects an invalid pod_url', async () => {
        const result = await createCloudPod(context(), parameters({ pod_url: 'not a url' }), {});
        expect(result.status).toBe(400);
    });
});

describe('POST /v1/comfy/cloud/prompt — stale-flag self-heal', () => {
    it('retries a proxy submission answered with HTTP 405 over the direct websocket', async () => {
        const calls: string[] = [];
        vi.mocked(fetch).mockImplementation(async (input: any, init: any) => {
            const url = String(input);
            calls.push(`${init?.method ?? 'GET'} ${url}`);
            if (url === `${POD_URL}/`) {
                // Native ComfyUI: POST / is not a route.
                return new Response('Method Not Allowed', { status: 405 });
            }
            if (url === `${POD_URL}/prompt`) {
                const payload = JSON.parse(init.body);
                expect(payload.client_id).toBe(CLIENT_ID);
                return new Response(JSON.stringify({ prompt_id: 'prompt-405', number: 1, node_errors: {} }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const result = await cloudPrompt(
            context(),
            parameters({
                pod_url: POD_URL,
                prompt: { '3': { class_type: 'KSampler', inputs: {} } },
                client_id: CLIENT_ID
            }),
            {}
        );

        expect(result.status).toBe(200);
        // Proxy attempt first, native /prompt retry second.
        expect(calls).toEqual([`POST ${POD_URL}/`, `POST ${POD_URL}/prompt`]);
        // The retry opened exactly one direct websocket.
        expect(testState.sockets).toHaveLength(1);
        expect(testState.sockets[0].url).toBe(`wss://pod-a.example/ws?clientId=${CLIENT_ID}`);

        const socket = testState.sockets[0];
        socket.emitMessage(JSON.stringify({ type: 'executing', data: { node: '3', prompt_id: 'prompt-405' } }));
        socket.emitMessage(JSON.stringify({ type: 'execution_success', data: { prompt_id: 'prompt-405' } }));

        const lines = await readStreamLines((result as any).raw as Response);
        expect(lines.at(0)).toEqual({
            type: 'proxy_enqueue',
            data: { prompt_id: 'prompt-405', number: 1, node_errors: {} }
        });
        expect(lines.at(-1)).toEqual({ type: 'proxy_done', data: {} });
    });

    it('leaves non-405 pod errors untouched (no websocket retry)', async () => {
        vi.mocked(fetch).mockImplementation(async (input: any, init: any) => {
            const url = String(input);
            if (url === `${POD_URL}/` && init?.method === 'POST') {
                return new Response(JSON.stringify({ error: 'bad prompt' }), {
                    status: 400,
                    headers: { 'content-type': 'application/json' }
                });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const result = await cloudPrompt(
            context(),
            parameters({ pod_url: POD_URL, prompt: { '3': { class_type: 'KSampler', inputs: {} } } }),
            {}
        );

        expect(result.status).toBe(400);
        expect((result as any).response).toEqual({ error: 'bad prompt' });
        expect(testState.sockets).toHaveLength(0);
    });
});
