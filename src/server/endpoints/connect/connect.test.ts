// =============================================================================
// Managed ComfyUI connection endpoint tests.
//
// The websocket is replaced with a deterministic EventTarget fake and fetch is
// stubbed, so these tests verify server-list selection, startup waiting,
// prompt forwarding, per-prompt JSON persistence, and the streaming log
// endpoint without requiring a running ComfyUI server.
// =============================================================================

// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fixed values make generated identifiers exact and reproducible in assertions.
const testState = vi.hoisted(() => ({
    uuidValues: [] as string[],
    sockets: [] as any[]
}));

// The production code uses randomUUID for both connect_id and ComfyUI client ids.
vi.mock('node:crypto', () => ({
    randomUUID: () => testState.uuidValues.shift() ?? '00000000-0000-0000-0000-000000000000'
}));

// The fake opens on the next microtask and emits ComfyUI's initial status frame.
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
                this.readyState = FakeWebSocket.OPEN;
                this.dispatchEvent(new Event('open'));
            });
        }

        send(_data: string): void {
            // The endpoint sends prompts over HTTP, matching native ComfyUI.
        }

        close(): void {
            if (this.readyState === FakeWebSocket.CLOSED) return;
            this.readyState = FakeWebSocket.CLOSED;
            this.dispatchEvent(new Event('close'));
        }

        emitMessage(data: string): void {
            this.dispatchEvent(new MessageEvent('message', { data }));
        }
    }

    return { WebSocket: FakeWebSocket };
});

import {
    closeAllConnections,
    connectServer,
    getConnectedPromptLog,
    sendConnectedPrompt,
    streamPromptLogEvents
} from './connect';
import {
    appendPromptLogEvent,
    connectPromptLogPath,
    ensurePromptLog,
    flushPromptLogWrites,
    readPromptLog
} from './connect-store';

const CONNECT_UUID = '11111111-1111-1111-1111-111111111111';
const CLIENT_UUID = '22222222-2222-2222-2222-222222222222';
const CLIENT_ID = '22222222222222222222222222222222';
const POD_URL = 'https://pod-a.example';
const POD_URL_B = 'https://pod-b.example';

let root: string;

// Minimal handler context: only the request header accessor is used by prompt forwarding.
function context() {
    return { req: { header: () => undefined } } as any;
}

// Build the exact parameter object passed by underload's HTTP adapter.
function parameters(
    pathParameters: Record<string, unknown>,
    body: Record<string, unknown> = {},
    query: Record<string, unknown> = {}
) {
    return { path: pathParameters, query, body } as any;
}

// An explicit single-server list keeps every test independent of the deployed
// server list, and exercises the variables.comfyServers override.
function variables(overrides: Record<string, unknown> = {}) {
    return { root, comfyServers: { testpod: POD_URL }, ...overrides };
}

// fetch behavior shared by the startup probe (GET /system_stats) and prompt
// submission (POST /prompt); per-URL overrides apply via `failures`.
function stubPodFetch(promptResponse?: { prompt_id: string; number: number; node_errors: Record<string, unknown> }) {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input: any) => {
        const url = String(input);
        if (url.endsWith('/system_stats')) {
            return new Response('{"system": {}}', { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (url.endsWith('/prompt')) {
            return new Response(JSON.stringify(promptResponse ?? { prompt_id: 'prompt-001', number: 1, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }
        throw new Error(`Unexpected fetch: ${url}`);
    });
    return fetchMock;
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-connect-test-'));
    testState.uuidValues = [CONNECT_UUID, CLIENT_UUID];
    testState.sockets.length = 0;
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(async () => {
    closeAllConnections();
    await flushPromptLogWrites();
    vi.unstubAllGlobals();
    fs.rmSync(root, { recursive: true, force: true });
});

describe('connectServer', () => {
    it('waits for ComfyUI startup, opens the websocket and returns the connection identifiers', async () => {
        const fetchMock = stubPodFetch();

        const result = await connectServer(context(), parameters({}), variables());

        expect(result).toEqual({
            status: 200,
            response: {
                connect_id: CONNECT_UUID,
                client_id: CLIENT_ID,
                server: 'testpod',
                pod_url: `${POD_URL}/`
            }
        });
        // The startup probe must have run before the websocket handshake.
        expect(fetchMock).toHaveBeenCalledWith(
            new URL(`${POD_URL}/system_stats`),
            expect.objectContaining({ method: 'GET' })
        );
        expect(testState.sockets).toHaveLength(1);
        expect(testState.sockets[0].url).toBe(`wss://pod-a.example/ws?clientId=${CLIENT_ID}`);

        // The recorder captures everything from the websocket — ComfyUI's
        // initial status frame carries no prompt_id, so it lands in the
        // connection's session log.
        testState.sockets[0].emitMessage(JSON.stringify({ type: 'status', data: { sid: CLIENT_ID } }));
        await vi.waitFor(async () => {
            const session = await readPromptLog(root, CONNECT_UUID, 'session');
            expect(session?.events.map((event) => event.message)).toEqual([
                { type: 'status', data: { sid: CLIENT_ID } }
            ]);
        });
    });

    it('picks the named server when the client supplies one', async () => {
        stubPodFetch();
        const result = await connectServer(
            context(),
            parameters({}, { server: 'second' }),
            variables({ comfyServers: { first: POD_URL, second: POD_URL_B } })
        );

        expect(result).toEqual({
            status: 200,
            response: {
                connect_id: CONNECT_UUID,
                client_id: CLIENT_ID,
                server: 'second',
                pod_url: `${POD_URL_B}/`
            }
        });
    });

    it('rejects an unknown server name without any network call', async () => {
        const fetchMock = stubPodFetch();
        const result = await connectServer(context(), parameters({}, { server: 'nope' }), variables());

        expect(result).toEqual({
            status: 400,
            response: { error: "Unknown ComfyUI server 'nope'", servers: ['testpod'] }
        });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(testState.sockets).toEqual([]);
    });

    it('fails over to the next server in the list when one does not start', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockImplementation(async (input: any) => {
            const url = String(input);
            if (url.startsWith(POD_URL)) throw new Error('connection refused');
            if (url.endsWith('/system_stats')) {
                return new Response('{"system": {}}', { status: 200, headers: { 'content-type': 'application/json' } });
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        const result = await connectServer(
            context(),
            parameters({}),
            variables({
                comfyServers: { dead: POD_URL, alive: POD_URL_B },
                connectReadyTimeoutMs: 60,
                connectReadyPollMs: 5
            })
        );

        expect(result.status).toBe(200);
        expect((result.response as any).server).toBe('alive');
        expect((result.response as any).pod_url).toBe(`${POD_URL_B}/`);
    });

    it('returns 502 when no server in the list starts within its window', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('connection refused'));

        const result = await connectServer(
            context(),
            parameters({}),
            variables({ connectReadyTimeoutMs: 60, connectReadyPollMs: 5 })
        );

        expect(result.status).toBe(502);
        expect(String((result.response as any).error)).toContain('No ComfyUI server could be started');
        expect(String((result.response as any).error)).toContain('testpod');
        expect(testState.sockets).toEqual([]);
    });

    it('returns 500 when the server list is empty', async () => {
        const result = await connectServer(context(), parameters({}), variables({ comfyServers: {} }));

        expect(result).toEqual({ status: 500, response: { error: 'No ComfyUI servers are configured' } });
    });
});

describe('sendConnectedPrompt', () => {
    it('forwards the prompt and records the returned prompt_id log', async () => {
        stubPodFetch();
        const connectResult = await connectServer(context(), parameters({}), variables());
        const connectId = (connectResult.response as any).connect_id;
        const fetchMock = vi.mocked(fetch);

        const result = await sendConnectedPrompt(
            context(),
            parameters({ connect_id: connectId }, { prompt: { '3': { class_type: 'EmptyLatentImage', inputs: {} } } }),
            variables()
        );

        expect(fetchMock).toHaveBeenCalledWith(`${POD_URL}/prompt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                prompt: { '3': { class_type: 'EmptyLatentImage', inputs: {} } },
                client_id: CLIENT_ID
            })
        });
        expect(result).toEqual({
            status: 200,
            response: {
                prompt_id: 'prompt-001',
                number: 1,
                node_errors: {},
                connect_id: CONNECT_UUID,
                client_id: CLIENT_ID
            }
        });

        // The prompt's log file is created as soon as ComfyUI assigns the id.
        await vi.waitFor(async () => {
            const log = await readPromptLog(root, CONNECT_UUID, 'prompt-001');
            expect(log?.promptId).toBe('prompt-001');
        });
    });

    it('returns 404 for a connect_id that is not active', async () => {
        const result = await sendConnectedPrompt(
            context(),
            parameters({ connect_id: CONNECT_UUID }, { prompt: {} }),
            variables()
        );

        expect(result).toEqual({
            status: 404,
            response: { error: `Connection '${CONNECT_UUID}' not found` }
        });
    });
});

describe('websocket recording per prompt', () => {
    it('files prompt events under their prompt_id and attributes unmarked frames to the active prompt', async () => {
        stubPodFetch();
        await connectServer(context(), parameters({}), variables());
        const socket = testState.sockets[0];

        socket.emitMessage(JSON.stringify({ type: 'execution_start', data: { prompt_id: 'prompt-001' } }));
        socket.emitMessage(JSON.stringify({ type: 'progress', data: { prompt_id: 'prompt-001', value: 1, max: 4 } }));
        // Binary preview frames carry no prompt_id — recorded as a lossless
        // envelope under the prompt currently in flight.
        socket.emitMessage(new TextEncoder().encode('png-bytes') as any);
        await vi.waitFor(async () => {
            const log = await readPromptLog(root, CONNECT_UUID, 'prompt-001');
            expect(log?.events).toHaveLength(3);
        });

        const log = await readPromptLog(root, CONNECT_UUID, 'prompt-001');
        expect(log?.events.map((event) => (event.message as any).type)).toEqual([
            'execution_start',
            'progress',
            'binary'
        ]);
        expect((log?.events[2].message as any).data).toBe(Buffer.from('png-bytes').toString('base64'));
    });
});

describe('prompt log storage and GET handler', () => {
    it('keeps one exact JSON file per prompt and returns it through the prompt route', async () => {
        const metadata = { connectId: CONNECT_UUID, promptId: 'prompt-001', podUrl: POD_URL };
        await ensurePromptLog(root, metadata, '2026-08-02T00:00:00.000Z');
        await appendPromptLogEvent(
            root,
            metadata,
            { type: 'execution_success', data: { prompt_id: 'prompt-001' } },
            '2026-08-02T00:00:01.000Z'
        );
        await flushPromptLogWrites();

        const expected = {
            connectId: CONNECT_UUID,
            promptId: 'prompt-001',
            podUrl: POD_URL,
            createdAt: '2026-08-02T00:00:00.000Z',
            updatedAt: '2026-08-02T00:00:01.000Z',
            events: [
                {
                    receivedAt: '2026-08-02T00:00:01.000Z',
                    message: { type: 'execution_success', data: { prompt_id: 'prompt-001' } }
                }
            ]
        };
        expect(await readPromptLog(root, CONNECT_UUID, 'prompt-001')).toEqual(expected);
        expect(JSON.parse(fs.readFileSync(connectPromptLogPath(root, CONNECT_UUID, 'prompt-001'), 'utf8'))).toEqual(expected);

        const result = await getConnectedPromptLog(
            context(),
            parameters({ connect_id: CONNECT_UUID, prompt_id: 'prompt-001' }),
            variables()
        );
        expect(result).toEqual({ status: 200, response: expected });
    });

    it('returns 404 for a prompt that has no recorded log', async () => {
        const result = await getConnectedPromptLog(
            context(),
            parameters({ connect_id: CONNECT_UUID, prompt_id: 'missing' }),
            variables()
        );

        expect(result).toEqual({ status: 404, response: { error: "Prompt 'missing' not found" } });
    });

    it('streams the recorded history and stays open until the terminal event', async () => {
        const metadata = { connectId: CONNECT_UUID, promptId: 'prompt-001', podUrl: POD_URL };
        await ensurePromptLog(root, metadata);
        await appendPromptLogEvent(root, metadata, { type: 'executing', data: { prompt_id: 'prompt-001', node: '3' } });
        await flushPromptLogWrites();
        const before = await readPromptLog(root, CONNECT_UUID, 'prompt-001');

        // ?stream=true returns the SSE generator instead of a JSON body.
        const result = await getConnectedPromptLog(
            context(),
            parameters({ connect_id: CONNECT_UUID, prompt_id: 'prompt-001' }, {}, { stream: 'true' }),
            variables()
        );
        expect(result.status).toBe(200);
        expect(typeof result.stream?.[Symbol.asyncIterator]).toBe('function');

        // History is replayed first; the generator then polls for new events
        // until the prompt's terminal event arrives on the websocket recorder.
        const received: unknown[] = [];
        const done = (async () => {
            for await (const event of streamPromptLogEvents(root, CONNECT_UUID, 'prompt-001', before, 5)) {
                received.push(event);
            }
        })();
        await vi.waitFor(() => expect(received).toHaveLength(1));

        await appendPromptLogEvent(root, metadata, { type: 'execution_success', data: { prompt_id: 'prompt-001' } });
        await flushPromptLogWrites();
        await done;

        expect(received.map((event: any) => event.message.type)).toEqual(['executing', 'execution_success']);
    });
});
