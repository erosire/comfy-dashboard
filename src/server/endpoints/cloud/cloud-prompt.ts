// Cloud prompt endpoint — POST /v1/comfy/cloud/prompt
//
// Sends a ComfyUI workflow payload to a spawned pod (Tier 2) and streams
// the NDJSON response back to the client over HTTPS.
//
// The request body must contain:
//   - pod_url:  the Tier 2 proxy URL (e.g. "https://...beam.cloud:8188")
//   - prompt:   the ComfyUI workflow graph object
//   - client_id: optional client identifier
//
// The response is proxied as a raw streaming Response (application/x-ndjson)
// so the client can read it incrementally, line-by-line.

import { asHandlerMethod } from '@underload/service';

export const cloudPrompt = asHandlerMethod(async (request, _parameters, _variables) => {
    const body = _parameters.body as {
        pod_url?: string;
        prompt?: Record<string, unknown>;
        client_id?: string;
    };

    if (!body?.pod_url) {
        return { status: 400, response: { error: 'pod_url is required' } };
    }

    if (!body?.prompt || typeof body.prompt !== 'object') {
        return { status: 400, response: { error: 'prompt object is required' } };
    }

    // Validate pod_url is a valid HTTPS URL
    let podUrl: URL;
    try {
        podUrl = new URL(body.pod_url);
    } catch {
        return { status: 400, response: { error: `Invalid pod_url: ${body.pod_url}` } };
    }

    // Build the prompt payload
    const promptPayload: Record<string, unknown> = {
        prompt: body.prompt,
    };
    if (body.client_id) {
        promptPayload.client_id = body.client_id;
    }

    try {
        // Proxy original request headers through (minus hop-by-hop)
        const incomingHeaders = request.req.header() as Record<string, string>;
        const forwardedHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/x-ndjson',
        };

        // Forward Authorization if present (for authenticated pods)
        if (incomingHeaders.authorization) {
            forwardedHeaders['Authorization'] = incomingHeaders.authorization;
        }

        const upstream = await fetch(podUrl.toString(), {
            method: 'POST',
            headers: forwardedHeaders,
            body: JSON.stringify(promptPayload),
            // @ts-expect-error -- Node.js fetch extension for disabling body timeout on streams
            bodyTimeout: 0,
        });

        if (!upstream.ok && upstream.headers.get('content-type')?.includes('application/json')) {
            // Non-streaming error from the pod — return as-is
            const errorBody = await upstream.json().catch(() => ({ error: `Pod returned HTTP ${upstream.status}` }));
            return {
                status: upstream.status,
                response: errorBody,
            };
        }

        // Stream the NDJSON response back to the client as a raw Response
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', 'application/x-ndjson');
        responseHeaders.set('Cache-Control', 'no-cache');
        responseHeaders.set('Connection', 'keep-alive');
        responseHeaders.set('Access-Control-Allow-Origin', '*');

        return {
            status: upstream.status,
            raw: new Response(upstream.body, {
                status: upstream.status,
                headers: responseHeaders,
            }),
        };
    } catch (err: any) {
        console.error(`[cloud/prompt] Error proxying to ${body.pod_url}:`, err.message);
        return {
            status: 502,
            response: { error: `Failed to reach pod: ${err.message}` },
        };
    }
});
