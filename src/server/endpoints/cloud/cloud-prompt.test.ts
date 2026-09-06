// Cloud prompt endpoint boundary tests.
//
// The pod registry (pod-socket.ts) is mocked so this test observes the exact
// payload produced by the endpoint boundary WITHOUT opening a websocket or
// contacting a pod: registry gating, UI-prepared prompt forwarding, the 202
// accepted response, the direct stream's envelope, and the ack-loss
// recovery / ghost-proofing paths (the generation json is real on disk in a
// temp root so the failed-at-submission writes are observable).

// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the registry calls observable while leaving prompt compilation in
// the real cloud-prompt handler under test.
const registry = vi.hoisted(() => ({
    getPodSocket: vi.fn(),
    submitPodPrompt: vi.fn(),
    // Reliable-submission surface — server-side processing ALWAYS rides
    // this (first attempt + bounded retries + queue probes); direct stream
    // mode keeps the single submitPodPrompt attempt.
    submitPodPromptReliably: vi.fn(),
    subscribePodPrompt: vi.fn(),
    releasePodSubmission: vi.fn()
}));

// The registry is mocked so loading the handler never opens a real websocket.
vi.mock('./pod-socket', () => registry);

import { cloudPrompt } from './cloud-prompt';
import { readGenerationFile, writeGenerationFile } from '../workflows/generation-store';

// The registry mocks are module-level — clear their call history before
// every test so "never called" assertions stay meaningful. (Implementations
// are re-set inside each test.)
beforeEach(() => {
    vi.clearAllMocks();
});

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
    it('submits server-side processing through the reliable submission loop and returns the shared client_id + prompt_id', async () => {
        registry.getPodSocket.mockReturnValue(connection);
        registry.submitPodPromptReliably.mockResolvedValue({
            kind: 'accepted',
            ack: { prompt_id: 'prompt-1', number: 1, node_errors: {} },
            recovered: false
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
        // Server-side mode rides the retry loop, keyed by the dashboard ids
        // (the pod's extra_data echo) and observed through the .log callback.
        expect(registry.submitPodPromptReliably.mock.calls).toEqual([[
            connection,
            {
                promptPayload: { prompt: apiPrompt },
                authorization: undefined,
                match: { workflowId: 'workflow-1', generationId: 'generation-1' }
            },
            expect.any(Function)
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

// Seed a real pending generation json so the failed-at-submission ghost
// proofing (failGenerationSubmission) is observable on disk.
async function seedPendingGeneration(workflowId: string, generationId: string): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-prompt-'));
    await fs.mkdir(path.join(root, 'comfy-workflows', workflowId, 'generation'), { recursive: true });
    await writeGenerationFile(root, workflowId, generationId, {
        id: generationId,
        status: 'pending',
        createdDate: '2026-08-05T10:00:00.000Z',
        completedDate: null,
        generatedTime: null,
        error: null,
        prompt: apiPrompt,
        result: []
    });
    return root;
}

describe('cloudPrompt reliable submission (server-side mode)', () => {
    it('resumes tracking a recovered prompt and answers 202 with its id', async () => {
        registry.getPodSocket.mockReturnValue(connection);
        // The submission's transport failed, but the probe found the prompt
        // on the pod — the loop reports it as a RECOVERED acceptance.
        registry.submitPodPromptReliably.mockResolvedValue({
            kind: 'accepted',
            ack: { prompt_id: 'prompt-rec' },
            recovered: true
        });
        registry.subscribePodPrompt.mockReturnValue(() => undefined);

        const result = await cloudPrompt(context(), parameters({
            pod_url: 'https://pod.example',
            prompt: apiPrompt,
            workflow_id: 'workflow-1',
            generation_id: 'generation-1'
        }), { root: '/tmp/anywhere' });

        // Accepted — the run is monitored again, NOT a 502 ghost.
        expect(result.status).toBe(202);
        expect(result.response).toEqual({
            accepted: true,
            workflow_id: 'workflow-1',
            generation_id: 'generation-1',
            client_id: 'podsharedclientid00000000000000',
            prompt_id: 'prompt-rec'
        });
        // Tracking rides the shared socket by the RECOVERED prompt_id.
        expect(registry.subscribePodPrompt.mock.calls).toEqual([[
            connection,
            { promptId: 'prompt-rec', onEvent: expect.any(Function) }
        ]]);
    });

    it('fails the generation json and relays 502 when the retry budget expires without acceptance', async () => {
        const root = await seedPendingGeneration('wf-1', 'gen-lost');
        try {
            registry.getPodSocket.mockReturnValue(connection);
            // Every retry failed and the pod never showed the prompt — the
            // loop gave up within its budget.
            registry.submitPodPromptReliably.mockResolvedValue({
                kind: 'gave-up',
                attempts: 3,
                message:
                    'The prompt was never accepted by the pod after 3 submission attempt(s) ' +
                    '(last error: fetch failed)'
            });

            const result = await cloudPrompt(context(), parameters({
                pod_url: 'https://pod.example',
                prompt: apiPrompt,
                workflow_id: 'wf-1',
                generation_id: 'gen-lost'
            }), { root });

            expect(result.status).toBe(502);
            expect(String((result.response as any).error)).toContain('never accepted');

            // The entry is definitively FAILED — never a pending ghost.
            const entry = await readGenerationFile(root, 'wf-1', 'gen-lost');
            expect(entry).toMatchObject({
                status: 'failed',
                error: expect.stringContaining('fetch failed'),
                result: []
            });
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });

    it('keeps direct stream mode on a single attempt — no retry loop, no generation to protect', async () => {
        registry.getPodSocket.mockReturnValue(connection);
        registry.submitPodPrompt.mockRejectedValue(new TypeError('fetch failed'));

        const result = await cloudPrompt(context(), parameters({
            pod_url: 'https://pod.example',
            prompt: apiPrompt
        }), {});

        expect(result.status).toBe(502);
        expect((result.response as any).error).toBe('Failed to reach pod: fetch failed');
        expect(registry.submitPodPromptReliably).not.toHaveBeenCalled();
        expect(registry.subscribePodPrompt).not.toHaveBeenCalled();
    });

    it('marks the generation failed when the pod REJECTS the prompt (validation error relay)', async () => {
        const root = await seedPendingGeneration('wf-1', 'gen-rej');
        try {
            registry.getPodSocket.mockReturnValue(connection);
            // The pod answered — a definitive 4xx rejection, no ack. The
            // loop surfaces it verbatim; retrying can never fix validation.
            registry.submitPodPromptReliably.mockResolvedValue({
                kind: 'rejected',
                response: new Response(JSON.stringify({ error: 'Prompt has no outputs' }), {
                    status: 400,
                    headers: { 'content-type': 'application/json' }
                })
            });

            const result = await cloudPrompt(context(), parameters({
                pod_url: 'https://pod.example',
                prompt: apiPrompt,
                workflow_id: 'wf-1',
                generation_id: 'gen-rej'
            }), { root });

            // The native pod error is relayed verbatim…
            expect(result.status).toBe(400);
            expect((result.response as any).error).toBe('Prompt has no outputs');
            // …and the generation file is failed, not left pending forever.
            const entry = await readGenerationFile(root, 'wf-1', 'gen-rej');
            expect(entry).toMatchObject({ status: 'failed', error: 'Prompt has no outputs' });
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
