// Cloud prompt endpoint — POST /v1/comfy/cloud/prompt
//
// Two modes:
//
// 1) Server-side processing — body includes `workflow_id` + `generation_id`.
//    The server submits the prompt to the pod, consumes the NDJSON stream
//    in the background, and keeps the generation json file updated by
//    itself (status → processing/completed/failed, results, stream, timing
//    — same file the workflow generation API writes). The client gets an
//    immediate 202 and observes progress by polling
//    GET /v1/comfy/workflows/:id/generate.
//
// 2) Legacy proxy mode — no workflow reference.
//    The pod's NDJSON stream is proxied back to the caller as-is
//    (application/x-ndjson) for the client to consume.
//
// Common request fields (mirrors beam_comfy_service PromptRequest schema):
//   - pod_url:  the Tier 2 proxy URL (e.g. "https://...beam.cloud:8188")
//   - prompt:   the ComfyUI workflow graph object
//   - client_id: optional client identifier (32-char hex)
//   - extra_data: passed through to ComfyUI's POST /prompt extra_data
//   - front / number: forwarded to ComfyUI POST /prompt

import { randomUUID } from 'node:crypto';
import { asHandlerMethod } from '@underload/service';
import {
    patchGenerationFile,
    type GenerationResultItem,
    type StreamEvent
} from '../workflows/generation-store';

/**
 * Generate a client_id for a prompt submission (32-char hex, as required
 * by the beam proxy / ComfyUI). One per submission: with several jobs
 * sharing a pod, this scopes which stream events belong to which job.
 */
function newClientId(): string {
    return randomUUID().replace(/-/g, '');
}

export const cloudPrompt = asHandlerMethod(async (request, _parameters, _variables) => {
    const body = _parameters.body as {
        pod_url?: string;
        prompt?: Record<string, unknown>;
        client_id?: string;
        extra_data?: Record<string, unknown>;
        front?: boolean;
        number?: number;
        workflow_id?: string;
        generation_id?: string;
    };

    if (!body?.pod_url) {
        return { status: 400, response: { error: 'pod_url is required' } };
    }

    if (!body?.prompt || typeof body.prompt !== 'object') {
        return { status: 400, response: { error: 'prompt object is required' } };
    }

    // Validate pod_url is a valid URL
    let podUrl: URL;
    try {
        podUrl = new URL(body.pod_url);
    } catch {
        return { status: 400, response: { error: `Invalid pod_url: ${body.pod_url}` } };
    }

    // Build the prompt payload per beam_comfy_service PromptRequest schema
    const promptPayload: Record<string, unknown> = {
        prompt: body.prompt,
    };
    if (body.client_id) {
        promptPayload.client_id = body.client_id;
    }
    if (body.extra_data !== undefined) {
        promptPayload.extra_data = body.extra_data;
    }
    if (body.front !== undefined) {
        promptPayload.front = body.front;
    }
    if (body.number !== undefined) {
        promptPayload.number = body.number;
    }

    // Forward Authorization if present (for authenticated pods)
    const incomingHeaders = request.req.header() as Record<string, string>;
    const authorization = incomingHeaders.authorization;

    // ── Mode 1: server-side processing ──────────────────────────────
    // The client submits and is done — the server owns the pod stream
    // and the generation json from here on.
    if (body.workflow_id && body.generation_id) {
        const root = _variables?.root as string | undefined;
        if (!root) {
            return { status: 500, response: { error: 'Server misconfigured: missing project root' } };
        }

        // One client_id per submission. Multiple generations can be queued
        // on the same pod, and the pod broadcasts every execution event to
        // all subscribers — this id ties the job to its prompt_id so the
        // stream consumer keeps only this job's events.
        const clientId =
            typeof body.client_id === 'string' && /^[0-9a-f]{32}$/i.test(body.client_id)
                ? body.client_id
                : newClientId();
        promptPayload.client_id = clientId;

        // Fire-and-forget — intentionally not awaited. The function never
        // rejects; all failures land in the generation file.
        void processPodPromptInBackground(
            root,
            body.workflow_id,
            body.generation_id,
            podUrl,
            promptPayload,
            authorization
        );

        return {
            status: 202,
            response: {
                accepted: true,
                workflow_id: body.workflow_id,
                generation_id: body.generation_id,
                client_id: clientId
            }
        };
    }

    // ── Mode 2: legacy streaming proxy ──────────────────────────────
    try {
        const forwardedHeaders: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/x-ndjson',
        };
        if (authorization) {
            forwardedHeaders['Authorization'] = authorization;
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

// ── Server-side background processing ───────────────────────────────

/**
 * Submit the prompt to the pod, consume its NDJSON stream, and persist
 * everything into the generation json file. Never throws — failures are
 * recorded in the generation entry itself.
 */
async function processPodPromptInBackground(
    root: string,
    workflowId: string,
    generationId: string,
    podUrl: URL,
    promptPayload: Record<string, unknown>,
    authorization?: string
): Promise<void> {
    const startedAt = Date.now();
    const events: StreamEvent[] = [];
    const results: GenerationResultItem[] = [];
    let failureMessage: string | null = null;
    const clientId = promptPayload.client_id as string | undefined;

    try {
        // Mark the generation as picked up so pollers see live progress
        const patched = patchGenerationFile(root, workflowId, generationId, { status: 'processing' });
        if (!patched) {
            console.warn(`[cloud/prompt] Generation '${generationId}' not found — aborting background processing`);
            return;
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Accept': 'application/x-ndjson',
        };
        if (authorization) {
            headers['Authorization'] = authorization;
        }

        const upstream = await fetch(podUrl.toString(), {
            method: 'POST',
            headers,
            body: JSON.stringify(promptPayload),
            // @ts-expect-error -- Node.js fetch extension for disabling body timeout on streams
            bodyTimeout: 0,
        });

        if (!upstream.ok) {
            const errorBody = await upstream
                .json()
                .catch(() => ({ error: `Pod returned HTTP ${upstream.status}` }));
            failureMessage =
                (errorBody as { error?: string })?.error ?? `Pod returned HTTP ${upstream.status}`;
        } else {
            failureMessage = await consumeNdjsonStream(upstream, events, results);
        }
    } catch (err: any) {
        failureMessage = err.message ?? String(err);
    }

    // Persist the final state — stream + results into the generation json
    const elapsed = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    const completedDate = new Date().toISOString();
    if (failureMessage) {
        patchGenerationFile(root, workflowId, generationId, {
            status: 'failed',
            error: failureMessage,
            result: results,
            stream: events,
            generatedTime: elapsed,
            completedDate
        });
        console.error(
            `[cloud/prompt] Generation ${generationId} (workflow ${workflowId}) failed ` +
            `in ${elapsed}: ${failureMessage}`
        );
    } else {
        patchGenerationFile(root, workflowId, generationId, {
            status: 'completed',
            error: null,
            result: results,
            stream: events,
            generatedTime: elapsed,
            completedDate
        });
        console.log(
            `[cloud/prompt] Generation ${generationId} (workflow ${workflowId}, client ${clientId}) completed ` +
            `in ${elapsed} — ${events.length} stream event(s), ${results.length} result(s)`
        );
    }
}

/**
 * Read the pod's NDJSON response to completion, collecting every event
 * into `events` and image previews into `results`.
 * Returns a failure message on execution_error/proxy_error, else null.
 */
async function consumeNdjsonStream(
    upstream: Response,
    events: StreamEvent[],
    results: GenerationResultItem[]
): Promise<string | null> {
    const reader = (upstream.body as ReadableStream<Uint8Array> | null)?.getReader();
    if (!reader) return 'Pod returned an empty body';

    const decoder = new TextDecoder();
    let buffer = '';
    let failureMessage: string | null = null;

    // ── Job scoping (client_id → prompt_id) ─────────────────────────
    // Several generations may share the pod at once; ComfyUI broadcasts
    // every execution event to all websocket subscribers, so this stream
    // can receive events belonging to OTHER jobs. Our submission's
    // prompt_id is learned from the proxy_enqueue acknowledgement; from
    // then on, any event carrying a DIFFERENT prompt_id is dropped.
    // Events without a prompt_id (status broadcasts, proxy_done, preview
    // frames) cannot be attributed that way and are kept — proxy_done is
    // emitted per subscription, so the stream still ends when OUR job
    // (the one tied to our client_id) finishes.
    let ourPromptId: string | null = null;

    /** Returns true when the event is terminal (stop reading). */
    const handleEvent = (event: StreamEvent): boolean => {
        if (event.type === 'proxy_enqueue') {
            const pid = (event.data as Record<string, unknown>)?.prompt_id;
            if (typeof pid === 'string') ourPromptId = pid;
        } else {
            const pid = (event.data as Record<string, unknown>)?.prompt_id;
            if (ourPromptId && typeof pid === 'string' && pid !== ourPromptId) {
                return false; // another job's event on this shared pod — ignore
            }
        }

        events.push(event);

        // Capture image previews as results
        const preview = extractPreviewResult(event);
        if (preview) results.push(preview);

        if (event.type === 'execution_error' || event.type === 'proxy_error') {
            const data = event.data as Record<string, unknown>;
            failureMessage =
                (data?.exception_message as string) ??
                (data?.error as string) ??
                `Generation failed (${event.type})`;
            return true;
        }
        return event.type === 'proxy_done';
    };

    try {
        let done = false;
        while (!done) {
            const { done: finished, value } = await reader.read();
            if (finished) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                let event: StreamEvent;
                try {
                    event = JSON.parse(trimmed) as StreamEvent;
                } catch {
                    console.warn('[cloud/prompt] Skipping malformed NDJSON line');
                    continue;
                }
                if (handleEvent(event)) {
                    done = true;
                    break;
                }
            }
        }

        // Flush any trailing line left in the buffer
        if (!done && buffer.trim()) {
            try {
                handleEvent(JSON.parse(buffer.trim()) as StreamEvent);
            } catch {
                // Ignore trailing incomplete JSON
            }
        }
    } finally {
        reader.releaseLock();
    }

    return failureMessage;
}

/**
 * Convert an `imagepreview.update` event into a result item.
 * The base64 data URL is kept as-is — it renders directly in <img src>
 * and, unlike blob URLs, survives a page reload since it lives in the
 * generation json.
 */
function extractPreviewResult(event: StreamEvent): GenerationResultItem | null {
    if (event.type !== 'imagepreview.update') return null;
    const data = event.data as Record<string, unknown>;
    const image = data?.image as string | undefined;
    if (!image || !image.startsWith('data:')) return null;

    const commaIdx = image.indexOf(',');
    if (commaIdx === -1) return null;

    const meta = image.substring(0, commaIdx);
    const b64 = image.substring(commaIdx + 1);
    const mimeMatch = meta.match(/^data:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    const size = Math.max(0, Math.floor((b64.length * 3) / 4) - padding);

    return {
        type: 'image',
        url: image,
        mimeType: mime,
        size,
        nodeId: (data?.node_id as string) ?? ''
    };
}
