// Cloud prompt endpoint boundary tests.
//
// The pod registry (pod-socket.ts) is mocked so this test observes the exact
// payload produced by the endpoint boundary WITHOUT opening a websocket or
// contacting a pod: registry gating, UI-prepared prompt forwarding, the 202
// accepted response, and the direct stream's envelope.

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

// Keep the registry calls observable while leaving prompt compilation in
// the real cloud-prompt handler under test.
const registry = vi.hoisted(() => ({
    getPodSocket: vi.fn(),
    submitPodPrompt: vi.fn(),
    subscribePodPrompt: vi.fn(),
    releasePodSubmission: vi.fn()
}));

// The registry is mocked so loading the handler never opens a real websocket.
vi.mock('./pod-socket', () => registry);

import { cloudPrompt } from './cloud-prompt';

// Use the parameter shape supplied by the service adapter, matching the other
// endpoint tests in this directory.
const context = () => ({ req: { header: () => ({}) } }) as any;
const parameters = (body: Record<string, unknown>) => ({ path: {}, query: {}, body }) as any;

// A registry-connected pod — the exact shape cloud-prompt reads.
const connection = {
    key: 'https://pod.example/',
    podUrl: new URL('https://pod.example'),
    clientId: 'podsharedclientid00000000000000',
    connectedAt: '2026-08-05T00:00:00.000Z',
    socket: {},
    subscribers: new Map(),
    pendingSubmissions: 0,
    buffered: new Map(),
    heartbeat: null,
    closed: false
} as any;

// The sample prompt is already in flat API format, so workflowToApiPrompt
// passes it through unchanged — the boundary's forwarding stays observable.
const apiPrompt = {
    '1': {
        class_type: 'TextBox',
        inputs: {
            prompt: 'Portrait of Ada in ',
            exact: 4
        }
    }
};

describe('cloudPrompt registry gating', () => {
    it('rejects a pod that is not websocket-connected (no registry entry)', async () => {
        registry.getPodSocket.mockReturnValue(null);

        const result = await cloudPrompt(context(), parameters({
            pod_url: 'https://pod.example',
            prompt: apiPrompt
        }), {});

        expect(result.status).toBe(502);
        expect(String((result.response as any).error)).toContain('Pod is not connected');
        // The pod is never contacted — no HTTP submission was attempted.
        expect(registry.submitPodPrompt).not.toHaveBeenCalled();
    });
});

describe('cloudPrompt UI-prepared prompt forwarding', () => {
    it('submits server-side processing on the pod connection and returns the shared client_id + prompt_id', async () => {
        registry.getPodSocket.mockReturnValue(connection);
        registry.submitPodPrompt.mockResolvedValue({
            response: new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
            ack: { prompt_id: 'prompt-1', number: 1, node_errors: {} }
        });
        registry.subscribePodPrompt.mockReturnValue(() => undefined);

        const result = await cloudPrompt(context(), parameters({
            pod_url: 'https://pod.example',
            // Preference tokens have already been replaced by the dashboard
            // before this request is created; the server only sees this JSON.
            prompt: apiPrompt,
            workflow_id: 'workflow-1',
            generation_id: 'generation-1'
        }), { root: '/tmp/anywhere' });

        expect(result.status).toBe(202);
        expect(result.response).toEqual({
            accepted: true,
            workflow_id: 'workflow-1',
            generation_id: 'generation-1',
            client_id: 'podsharedclientid00000000000000',
            prompt_id: 'prompt-1'
        });
        expect(registry.submitPodPrompt.mock.calls).toEqual([[
            connection,
            {
                promptPayload: { prompt: apiPrompt },
                authorization: undefined
            }
        ]]);
        // The generation processor rides the shared socket by prompt_id.
        expect(registry.subscribePodPrompt.mock.calls).toEqual([[
            connection,
            { promptId: 'prompt-1', onEvent: expect.any(Function) }
        ]]);
    });

    it('streams the prompt_queued acknowledgement first in direct mode', async () => {
        registry.getPodSocket.mockReturnValue(connection);
        registry.submitPodPrompt.mockResolvedValue({
            response: new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
            ack: { prompt_id: 'prompt-9', number: 7, node_errors: {} }
        });
        let subscriber: { promptId: string; onEvent: (event: any) => void } | null = null;
        registry.subscribePodPrompt.mockImplementation((_conn: any, sub: any) => {
            subscriber = sub;
            return () => undefined;
        });

        const result = await cloudPrompt(context(), parameters({
            pod_url: 'https://pod.example',
            prompt: apiPrompt
        }), {});

        expect(result.status).toBe(200);
        expect(subscriber).toEqual({ promptId: 'prompt-9', onEvent: expect.any(Function) });

        // Read the stream to the end: the ack envelope leads, the routed
        // event follows, and the terminal envelope closes it. Chunk
        // boundaries are not per-event, so drain until the stream closes.
        const readAll = (async () => {
            const reader = (result as any).raw.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
            }
            return buffer;
        })();
        // Yield so the stream's start()/ack write lands before events arrive.
        await Promise.resolve();
        subscriber!.onEvent({ type: 'executing', data: { node: '1', prompt_id: 'prompt-9' } });
        subscriber!.onEvent({ type: 'execution_success', data: { prompt_id: 'prompt-9' } });

        const buffer = await readAll;
        const lines = buffer.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
        expect(lines).toEqual([
            { type: 'prompt_queued', data: { prompt_id: 'prompt-9', number: 7, node_errors: {} } },
            { type: 'executing', data: { node: '1', prompt_id: 'prompt-9' } },
            { type: 'execution_success', data: { prompt_id: 'prompt-9' } },
            { type: 'prompt_done', data: {} }
        ]);
    });
});
