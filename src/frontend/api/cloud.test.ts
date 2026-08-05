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
    it('GETs /cloud and returns the active pod list', async () => {
        const pods = [
            {
                pod_url: 'https://pod-a.example/',
                gpu: '4090',
                name: 'dev pod',
                client_id: 'abc123def4567890fedcba0987654321',
                active: true,
                prompts: 2,
                connectedAt: '2026-08-05T10:15:30.000Z'
            },
            {
                pod_url: 'https://pod-b.example/',
                client_id: '000aaaaabbbbccccddddeeeeffff0123',
                active: true,
                prompts: 0,
                connectedAt: '2026-08-05T10:20:41.000Z'
            }
        ];
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ pods }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const result = await cloudListPods('http://dashboard.example/v1/comfy');

        expect(vi.mocked(fetch).mock.calls).toEqual([
            ['http://dashboard.example/v1/comfy/cloud', { method: 'GET' }]
        ]);
        expect(result).toEqual({ pods });
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
