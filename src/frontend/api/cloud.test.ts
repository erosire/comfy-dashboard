// Direct ComfyUI dashboard API tests.
//
// These tests lock the public request shape to the native websocket transport
// and verify that the direct event stream reader preserves complete events.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudListPods, cloudPrompt, cloudReadNdjson } from './cloud';

// Each test installs its own deterministic response so no real pod is called.
beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('cloudPrompt', () => {
    it('sends a native direct prompt request without transport-selection flags', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response('{"type":"prompt_done","data":{}}\n', {
                status: 200,
                headers: { 'content-type': 'application/x-ndjson' }
            })
        );

        await cloudPrompt('http://dashboard.example/v1/comfy', {
            pod_url: 'https://pod.example',
            prompt: { '3': { class_type: 'KSampler', inputs: {} } },
            workflow_id: 'workflow-1',
            generation_id: 'generation-1'
        });

        expect(vi.mocked(fetch).mock.calls).toEqual([
            [
                'http://dashboard.example/v1/comfy/cloud/prompt',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        pod_url: 'https://pod.example',
                        prompt: { '3': { class_type: 'KSampler', inputs: {} } },
                        workflow_id: 'workflow-1',
                        generation_id: 'generation-1'
                    })
                }
            ]
        ]);
    });
});

describe('cloudListPods', () => {
    it('GETs /cloud and returns the API GPU keys with the active pod list and each pod queue', async () => {
        const available_gpus = ['4090', '6000'];
        const pods = [
            {
                pod_url: 'https://pod-a.example/',
                gpu: '4090',
                name: 'dev pod',
                client_id: 'abc123def4567890fedcba0987654321',
                active: true,
                prompts: 2,
                // The server-tracked queue — the ONLY queue source the UI uses.
                queue: [
                    {
                        prompt_id: 'prompt-1',
                        number: 1,
                        status: 'running',
                        workflow_id: 'wf-1',
                        generation_id: 'gen-1',
                        queuedAt: '2026-08-05T10:15:31.000Z',
                        startedAt: '2026-08-05T10:15:32.000Z'
                    },
                    {
                        prompt_id: 'prompt-2',
                        number: 2,
                        status: 'queued',
                        workflow_id: 'wf-1',
                        generation_id: 'gen-2',
                        queuedAt: '2026-08-05T10:15:33.000Z',
                        startedAt: null
                    }
                ],
                connectedAt: '2026-08-05T10:15:30.000Z'
            },
            {
                pod_url: 'https://pod-b.example/',
                client_id: '000aaaaabbbbccccddddeeeeffff0123',
                active: true,
                prompts: 0,
                queue: [],
                connectedAt: '2026-08-05T10:20:41.000Z'
            }
        ];
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ available_gpus, pods }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const result = await cloudListPods('http://dashboard.example/v1/comfy');

        expect(vi.mocked(fetch).mock.calls).toEqual([
            ['http://dashboard.example/v1/comfy/cloud', { method: 'GET' }]
        ]);
        expect(result).toEqual({ available_gpus, pods });
    });

    it('throws the server error message when the list fails', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ error: 'registry unavailable' }), {
                status: 500,
                headers: { 'content-type': 'application/json' }
            })
        );

        await expect(cloudListPods('http://dashboard.example/v1/comfy')).rejects.toThrow('registry unavailable');
    });
});

describe('cloudReadNdjson', () => {
    it('reads the direct prompt events in exact stream order', async () => {
        const response = new Response(
            '{"type":"prompt_queued","data":{"prompt_id":"prompt-1"}}\n' +
                '{"type":"execution_success","data":{"prompt_id":"prompt-1"}}\n' +
                '{"type":"prompt_done","data":{}}\n',
            { headers: { 'content-type': 'application/x-ndjson' } }
        );

        const events = [];
        for await (const event of cloudReadNdjson(response)) events.push(event);

        expect(events).toEqual([
            { type: 'prompt_queued', data: { prompt_id: 'prompt-1' } },
            { type: 'execution_success', data: { prompt_id: 'prompt-1' } },
            { type: 'prompt_done', data: {} }
        ]);
    });
});
