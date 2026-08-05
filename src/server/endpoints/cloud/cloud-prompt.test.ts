// Cloud prompt preference-compilation tests.
//
// The pod transport is mocked so this test observes the exact payload produced
// by the endpoint boundary without opening a websocket or contacting a pod.

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

// Keep the native transport call observable while leaving prompt compilation
// in the real cloud-prompt handler under test.
const transport = vi.hoisted(() => vi.fn());

// The transport is mocked so loading the handler never opens a real websocket.
vi.mock('./direct-comfy', () => ({
    newDirectClientId: () => '0123456789abcdef0123456789abcdef',
    submitDirectPrompt: transport
}));

import { cloudPrompt } from './cloud-prompt';

// Use the parameter shape supplied by the service adapter, matching the other
// endpoint tests in this directory.
const context = () => ({ req: { header: () => ({}) } }) as any;
const parameters = (body: Record<string, unknown>) => ({ path: {}, query: {}, body }) as any;

describe('cloudPrompt UI-prepared prompt forwarding', () => {
    it('forwards the UI-prepared JSON without a preference payload', async () => {
        // The response only needs to be a successful NDJSON-shaped native
        // response because this test stops at the pod-facing request boundary.
        transport.mockResolvedValue(new Response('{}\n', {
            status: 200,
            headers: { 'content-type': 'application/x-ndjson' }
        }));

        const result = await cloudPrompt(context(), parameters({
            pod_url: 'https://pod.example',
            // Preference tokens have already been replaced by the dashboard
            // before this request is created; the server only sees this JSON.
            prompt: {
                '1': {
                    class_type: 'TextBox',
                    inputs: {
                        prompt: 'Portrait of Ada in ',
                        exact: 4
                    }
                }
            }
        }), {});

        expect(result.status).toBe(200);
        expect(transport.mock.calls).toEqual([[
            {
                podUrl: new URL('https://pod.example/'),
                clientId: '0123456789abcdef0123456789abcdef',
                promptPayload: {
                    prompt: {
                        '1': {
                            class_type: 'TextBox',
                            inputs: {
                                prompt: 'Portrait of Ada in ',
                                exact: 4
                            }
                        }
                    },
                },
                authorization: undefined
            }
        ]]);
    });
});
