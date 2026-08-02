// =============================================================================
// Tier 2 proxy (ComfyProxy) pod support tests (endpoints/cloud/proxy-comfy.ts).
// The sibling shape's tests live in ./direct-comfy.test.ts; the dispatch
// between the two shapes is covered there too (POST /v1/comfy/cloud
// is_direct detection, and the /cloud/prompt stale-flag 405 self-heal).
//
// fetch is stubbed, so the status probe and prompt submission run without a
// real proxy pod.
// =============================================================================

// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeProxyStatus, submitProxyPrompt } from './proxy-comfy';

const POD_URL = 'https://pod-a.example';
const STATUS_DOCUMENT = { health: { healthy: true }, models_dir: '/models', models: { checkpoints: ['x.safetensors'] } };

beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('probeProxyStatus', () => {
    it('returns the JSON status document when a Tier 2 proxy answers', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify(STATUS_DOCUMENT), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        );

        const probe = await probeProxyStatus(new URL(POD_URL));
        expect(probe).toMatchObject({ ok: true, json: STATUS_DOCUMENT });
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${POD_URL}/`);
    });

    it('returns ok WITHOUT json for HTTP 200 HTML (the direct ComfyUI signature)', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response('<!doctype html><html>ComfyUI</html>', {
                status: 200,
                headers: { 'content-type': 'text/html' }
            })
        );

        const probe = await probeProxyStatus(new URL(POD_URL));
        expect(probe.ok).toBe(true);
        expect(probe.json).toBeUndefined();
    });

    it('reports the non-2xx status and a body hint', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('temporarily unavailable', { status: 503 }));

        const probe = await probeProxyStatus(new URL(POD_URL));
        expect(probe).toMatchObject({ ok: false, status: 503, detail: 'temporarily unavailable' });
    });

    it('reports unreachable pods as a fetch-level error', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('connect ECONNREFUSED'));

        const probe = await probeProxyStatus(new URL(POD_URL));
        expect(probe.ok).toBe(false);
        expect(probe.error).toContain('ECONNREFUSED');
    });
});

describe('submitProxyPrompt', () => {
    it('POSTs the payload to the pod_url itself with the NDJSON accept header', async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response('{"type":"proxy_done","data":{}}\n', {
                status: 200,
                headers: { 'content-type': 'application/x-ndjson' }
            })
        );

        const promptPayload = { prompt: { '3': { class_type: 'KSampler', inputs: {} } }, client_id: 'a'.repeat(32) };
        const response = await submitProxyPrompt({ podUrl: new URL(POD_URL), promptPayload });

        expect(response.status).toBe(200);
        const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe(`${POD_URL}/`);
        expect(init.method).toBe('POST');
        expect((init.headers as Record<string, string>)['Accept']).toBe('application/x-ndjson');
        expect(JSON.parse(init.body as string)).toEqual(promptPayload);
    });

    it('forwards the Authorization header for authenticated pods', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('', { status: 200 }));

        await submitProxyPrompt({
            podUrl: new URL(POD_URL),
            promptPayload: { prompt: {} },
            authorization: 'Bearer token-123'
        });

        const [, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
        expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer token-123');
    });

    it('relays the pod response untouched (405 hands the stale-flag self-heal to the caller)', async () => {
        vi.mocked(fetch).mockResolvedValue(new Response('Method Not Allowed', { status: 405 }));

        const response = await submitProxyPrompt({ podUrl: new URL(POD_URL), promptPayload: { prompt: {} } });

        expect(response.status).toBe(405);
    });
});
