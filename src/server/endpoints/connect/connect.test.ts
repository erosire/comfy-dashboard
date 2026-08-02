// =============================================================================
// Direct ComfyUI connection endpoint tests.
//
// The websocket is replaced with a deterministic EventTarget fake so these
// tests verify URL construction, handshake registration, prompt forwarding,
// and per-client JSON persistence without requiring a running ComfyUI pod.
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

// The production code uses randomUUID for both connectId and ComfyUI client ids.
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
    connectPod,
    getConnectedRequest,
    sendConnectedPrompt
} from './connect';
import {
    appendClientLogEvent,
    connectClientLogPath,
    ensureClientLog,
    flushClientLogWrites,
    readClientLog
} from './connect-store';

const CONNECT_UUID = '11111111-1111-1111-1111-111111111111';
const CLIENT_UUID = '22222222-2222-2222-2222-222222222222';
const CLIENT_ID = '22222222222222222222222222222222';
const CONNECT_ID = '11111111111111111111111111111111';
const POD_URL = 'https://pod.example:8188';

let root: string;

// Minimal handler context: only the request header accessor is used by prompt forwarding.
function context() {
    return { req: { header: () => undefined } } as any;
}

// Build the exact parameter object passed by underload's HTTP adapter.
function parameters(pathParameters: Record<string, unknown>, body: Record<string, unknown> = {}) {
    return { path: pathParameters, query: {}, body } as any;
}

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'comfy-connect-test-'));
    testState.uuidValues = [CONNECT_UUID, CLIENT_UUID];
    testState.sockets.length = 0;
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(async () => {
    closeAllConnections();
    await flushClientLogWrites();
    vi.unstubAllGlobals();
    fs.rmSync(root, { recursive: true, force: true });
});

describe('connectPod', () => {
    it('opens the direct websocket and returns exact connection identifiers', async () => {
        const result = await connectPod(
            context(),
            parameters({}, { pod_url: POD_URL }),
            { root }
        );

        expect(result).toEqual({
            status: 200,
            response: {
                connectId: CONNECT_ID,
                client_id: CLIENT_ID
            }
        });
        expect(testState.sockets).toHaveLength(1);
        expect(testState.sockets[0].url).toBe(
            `wss://pod.example:8188/ws?clientId=${CLIENT_ID}`
        );
        // Simulate ComfyUI's initial status frame after the handshake so the
        // test controls exactly when the asynchronous event reader runs.
        testState.sockets[0].emitMessage(
            JSON.stringify({ type: 'status', data: { sid: CLIENT_ID } })
        );
        // Wait for the asynchronous websocket callback and assert its complete
        // event payload rather than relying on a timing-based sleep.
        await vi.waitFor(async () => {
            const current = await readClientLog(root, CONNECT_ID, CLIENT_ID);
            expect(current?.events.map((event) => event.message)).toEqual([
                { type: 'status', data: { sid: CLIENT_ID } }
            ]);
        });
        await flushClientLogWrites();
        const log = await readClientLog(root, CONNECT_ID, CLIENT_ID);
        expect(log?.connectId).toBe(CONNECT_ID);
        expect(log?.clientId).toBe(CLIENT_ID);
        expect(log?.events.map((event) => event.message)).toEqual([
            { type: 'status', data: { sid: CLIENT_ID } }
        ]);
    });

    it('rejects a malformed pod URL without opening a websocket', async () => {
        const result = await connectPod(
            context(),
            parameters({}, { pod_url: 'not-a-url' }),
            { root }
        );

        expect(result).toEqual({
            status: 400,
            response: { error: 'A valid pod_url is required' }
        });
        expect(testState.sockets).toEqual([]);
    });
});

describe('sendConnectedPrompt', () => {
    it('forwards the exact native prompt and returns the client log identifier', async () => {
        const connectResult = await connectPod(
            context(),
            parameters({}, { pod_url: POD_URL }),
            { root }
        );
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValue(
            new Response(JSON.stringify({ prompt_id: 'prompt-001', number: 1, node_errors: {} }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const result = await sendConnectedPrompt(
            context(),
            parameters(
                { connect_id: (connectResult.response as any).connectId },
                { prompt: { '3': { class_type: 'EmptyLatentImage', inputs: {} } } }
            ),
            { root }
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
                connectId: CONNECT_ID,
                client_id: CLIENT_ID
            }
        });
    });

    it('returns 404 for a connectId that is not active', async () => {
        const result = await sendConnectedPrompt(
            context(),
            parameters({ connect_id: CONNECT_ID }, { prompt: {} }),
            { root }
        );

        expect(result).toEqual({
            status: 404,
            response: { error: `Connection '${CONNECT_ID}' not found` }
        });
    });
});

describe('client log storage and GET handler', () => {
    it('keeps one exact JSON file per client id and returns it through the request route', async () => {
        const metadata = { connectId: CONNECT_ID, clientId: CLIENT_ID, podUrl: POD_URL };
        await ensureClientLog(root, metadata, '2026-08-02T00:00:00.000Z');
        await appendClientLogEvent(
            root,
            metadata,
            { type: 'execution_success', data: { prompt_id: 'prompt-001' } },
            '2026-08-02T00:00:01.000Z'
        );
        await flushClientLogWrites();

        const expected = {
            connectId: CONNECT_ID,
            clientId: CLIENT_ID,
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
        expect(await readClientLog(root, CONNECT_ID, CLIENT_ID)).toEqual(expected);
        expect(JSON.parse(fs.readFileSync(connectClientLogPath(root, CONNECT_ID, CLIENT_ID), 'utf8'))).toEqual(expected);

        const result = await getConnectedRequest(
            context(),
            parameters({ connect_id: CONNECT_ID, client_id: CLIENT_ID }),
            { root }
        );
        expect(result).toEqual({ status: 200, response: expected });
    });
});
