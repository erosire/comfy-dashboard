// Cloud prompt endpoint — POST /v1/comfy/cloud/prompt
//
// The pod must already hold a server-managed websocket: pods are spawned
// (or adopted) via POST /v1/comfy/cloud, which keeps ONE persistent socket
// per pod in memory (pod-socket.ts). This endpoint NEVER opens another
// websocket — it gates on the registry, submits natively over HTTP POST
// <pod>/prompt with the shared socket's client_id, learns the prompt_id
// from the acknowledgement, and consumes the run from the shared socket's
// demultiplexed events (matched by prompt_id).
//
// 1) Server-side processing — body includes `workflow_id` + `generation_id`.
//    The endpoint registers a prompt_id subscriber and answers 202
//    immediately. Every event the shared socket routes to that prompt_id is
//    traced line-by-line into the generation's sibling .log file (one log
//    per prompt) and folded into the generation json itself (status →
//    processing/completed/failed, results, timing — the same file the
//    workflow generation API writes). Clients poll
//    GET /v1/comfy/workflows/:id/generate for progress.
//
// 2) Direct stream mode — no workflow reference.
//    The same shared socket's events (this prompt's prompt_id plus
//    unattributed broadcasts) stream back as application/x-ndjson — one
//    JSON object per line, terminated by prompt_done / execution_error /
//    prompt_error.
//
// Common request fields (mirrors beam_comfy_service PromptRequest schema):
//   - pod_url:   the native ComfyUI pod URL (must be registry-connected)
//   - prompt:    the ORIGINAL workflow json snapshot (v0.4/v1 editor format
//                — what the dashboard stores on every generation). Converted
//                to the flat API prompt HERE, server-side, right before it
//                goes out to the Comfy Cloud pod — the one place conversion
//                happens, so stored documents stay lossless.
//   - client_id: accepted for compatibility and ignored; the pod's shared
//                websocket client_id is what binds events to the socket
//   - extra_data: passed through to ComfyUI's POST /prompt extra_data
//   - front / number: forwarded to ComfyUI POST /prompt
//

import { asHandlerMethod } from '@underload/service';
import { workflowToApiPrompt } from '../../../frontend/features/workflow/components/utils/workflow-prompt';
import { extractServerClientDataResults } from '../../../frontend/features/workflow/components/utils/stream-results';
import {
    appendGenerationLog,
    patchGenerationFile,
    persistResultAssets,
    type GenerationResultItem,
    type StreamEvent
} from '../workflows/generation-store';
import {
    getPodSocket,
    releasePodSubmission,
    subscribePodPrompt,
    submitPodPrompt,
    type PodPromptAck,
    type PodSocketConnection
} from './pod-socket';

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

    // Gate on the server's pod registry: the pod must hold its ONE
    // persistent websocket already. This endpoint never opens another
    // socket — unknown or terminated pods are rejected instead.
    const connection = getPodSocket(podUrl);
    if (!connection) {
        return {
            status: 502,
            response: {
                error:
                    `Pod is not connected — no active websocket for ${body.pod_url} ` +
                    `(spawn or verify it via POST /v1/comfy/cloud first)`
            }
        };
    }

    // Convert the already-prepared workflow json into the flat API prompt
    // ComfyUI's POST /prompt expects. Preference replacement happens in the UI
    // before this request, so this server boundary performs only format
    // conversion and never needs a second preference payload.
    const apiPrompt = workflowToApiPrompt(body.prompt);

    // Build the prompt payload per beam_comfy_service PromptRequest schema
    const promptPayload: Record<string, unknown> = {
        prompt: apiPrompt,
    };
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

    // Submit over HTTP ONLY — the pod's persistent websocket (and its
    // client_id pairing) delivers every execution event for this prompt.
    let submission: { response: Response; ack: PodPromptAck | null };
    try {
        submission = await submitPodPrompt(connection, { promptPayload, authorization });
    } catch (err: any) {
        console.error(`[cloud/prompt] Error submitting to ${body.pod_url}:`, err.message);
        return {
            status: 502,
            response: { error: `Failed to reach pod: ${err.message}` },
        };
    }

    const { response: upstream, ack } = submission;
    if (!upstream.ok || !ack) {
        // Relay the pod's own native error response so the caller can expose
        // ComfyUI's validation details without rewriting them.
        const errorBody = await upstream.json().catch(() => ({ error: `Pod returned HTTP ${upstream.status}` }));
        return {
            status: upstream.ok ? 502 : upstream.status,
            response: errorBody,
        };
    }

    // ── Mode 1: server-side processing ──────────────────────────────
    // The client submits and is done — the server owns the pod stream
    // events and the generation json from here on.
    if (body.workflow_id && body.generation_id) {
        const root = _variables?.root as string | undefined;
        if (!root) {
            return { status: 500, response: { error: 'Server misconfigured: missing project root' } };
        }

        // Fire-and-forget tracking: the subscriber folds every routed event
        // into the generation .log/json until the run reaches a terminal
        // state (or the pod socket dies — the registry emits prompt_error).
        trackGenerationOnPod(root, body.workflow_id, body.generation_id, connection, ack);

        return {
            status: 202,
            response: {
                accepted: true,
                workflow_id: body.workflow_id,
                generation_id: body.generation_id,
                client_id: connection.clientId,
                prompt_id: ack.prompt_id ?? null
            }
        };
    }

    // ── Mode 2: direct event stream off the shared socket ────────────
    const stream = buildPodEventStream(connection, ack);

    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', 'application/x-ndjson');
    responseHeaders.set('Cache-Control', 'no-cache');
    responseHeaders.set('Connection', 'keep-alive');
    responseHeaders.set('Access-Control-Allow-Origin', '*');

    return {
        status: 200,
        raw: new Response(stream, {
            status: 200,
            headers: responseHeaders,
        }),
    };
});

// ── Server-side background processing ───────────────────────────────

/**
 * Consume one prompt's events off the pod's shared websocket, persist the
 * outcome (status, results, timing, error) into the generation json file,
 * and trace every event into the sibling .log file (one log per prompt_id —
 * the raw events are intentionally NOT stored in the json).
 *
 * Driven PUSH-style by the pod registry (see pod-socket.ts — events arrive
 * matched by prompt_id); never throws — failures land in the generation
 * entry itself. Terminals: execution_success / execution_interrupted
 * (completion) and execution_error / prompt_error (failure, incl. the
 * registry's socket-death terminal).
 */
function trackGenerationOnPod(
    root: string,
    workflowId: string,
    generationId: string,
    connection: PodSocketConnection,
    ack: PodPromptAck
): void {
    const startedAt = Date.now();
    const results: GenerationResultItem[] = [];
    let eventCount = 0;
    let finished = false;
    let unsubscribe: () => void = () => undefined;

    // Append a timestamped line to <generationId>.log (next to the .json)
    // at every status change and routed event. Best-effort — never throws.
    // Fire-and-forget: appends are chained per log file inside the store,
    // so rapid event bursts still land in strict chronological order.
    const log = (message: string) =>
        void appendGenerationLog(root, workflowId, generationId, message);

    const promptId = typeof ack.prompt_id === 'string' ? ack.prompt_id : '';
    log(
        `Generation started — submitting to ${connection.podUrl.toString()} ` +
        `(ComfyUI shared websocket, client_id: ${connection.clientId}, prompt_id: ${promptId || 'n/a'})`
    );

    /**
     * Persist the final state — result payloads (base64 data: urls captured
     * from the stream) are first moved onto disk as plain asset files; the
     * json keeps only `file:` references to them (persistResultAssets).
     */
    const finalize = async (failureMessage: string | null) => {
        if (finished) return;
        finished = true;
        unsubscribe();

        const elapsed = `${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
        const completedDate = new Date().toISOString();
        const persistedResults = await persistResultAssets(root, workflowId, generationId, results);
        if (results.some((r, i) => r.url !== persistedResults[i].url)) {
            log(`Persisted result payload(s) to asset files under generation/${generationId}/`);
        }
        if (failureMessage) {
            await patchGenerationFile(root, workflowId, generationId, {
                status: 'failed',
                error: failureMessage,
                result: persistedResults,
                generatedTime: elapsed,
                completedDate
            });
            log(`Generation FAILED in ${elapsed}: ${failureMessage} (${eventCount} event(s), ${results.length} result(s))`);
            console.error(
                `[cloud/prompt] Generation ${generationId} (workflow ${workflowId}) failed ` +
                `in ${elapsed}: ${failureMessage}`
            );
        } else {
            await patchGenerationFile(root, workflowId, generationId, {
                status: 'completed',
                error: null,
                result: persistedResults,
                generatedTime: elapsed,
                completedDate
            });
            log(`Generation COMPLETED in ${elapsed} — ${eventCount} event(s), ${results.length} result(s)`);
            console.log(
                `[cloud/prompt] Generation ${generationId} (workflow ${workflowId}, client ${connection.clientId}) completed ` +
                `in ${elapsed} — ${eventCount} stream event(s), ${results.length} result(s)`
            );
        }
    };

    // ComfyUI rejected the prompt at validation time: it will never
    // execute, so no execution events will ever arrive. Finalize directly
    // with the same error the old stream path synthesized — no subscriber
    // is ever registered, so the pending submission count is released
    // explicitly (keeps GET /v1/comfy/cloud's per-pod prompt count honest).
    const nodeErrors = ack.node_errors;
    if (nodeErrors && typeof nodeErrors === 'object' && Object.keys(nodeErrors).length > 0) {
        releasePodSubmission(connection);
        log(`Prompt validation failed: ${JSON.stringify(nodeErrors)}`);
        void finalize(`Prompt validation failed: ${JSON.stringify(nodeErrors)}`);
        return;
    }

    // Mark the generation as picked up so pollers see live progress. If the
    // file is already gone, drop the subscriber — there is nothing to update.
    void patchGenerationFile(root, workflowId, generationId, { status: 'processing' }).then((patched) => {
        if (!patched && !finished) {
            log(`Generation '${generationId}' not found — aborting background processing`);
            console.warn(`[cloud/prompt] Generation '${generationId}' not found — aborting background processing`);
            finished = true;
            unsubscribe();
        }
    });

    unsubscribe = subscribePodPrompt(connection, {
        promptId,
        onEvent: (event) => {
            if (finished) return;

            // Count + trace every event — the .log trail replaces the old
            // practice of persisting the raw events into the generation json.
            eventCount++;
            log(`Event: ${event.type} ${summarizeEventData(event.data)}`);

            // Capture image previews as results
            const preview = extractPreviewResult(event);
            if (preview) {
                results.push(preview);
                log(`Captured preview image from node ${preview.nodeId} (${preview.mimeType}, ${preview.size} bytes)`);
            }

            // Capture server_client_data file payloads — the ComfyUI-CloudClient
            // save nodes (ClientImageSaveNode / ClientVideoSaveNode) ship their
            // PNG/GIF/MP4/WEBM output over the stream as base64 files.
            for (const file of extractServerClientDataResults(event)) {
                results.push(file.result);
                log(
                    `Captured server_client_data file '${file.filename || '(unnamed)'}' ` +
                        `(${file.result.mimeType}, ${file.result.size} bytes)`
                );
            }

            if (event.type === 'execution_error' || event.type === 'prompt_error') {
                const data = event.data as Record<string, unknown>;
                const failureMessage =
                    (data?.exception_message as string) ??
                    (data?.error as string) ??
                    `Generation failed (${event.type})`;
                log(`Terminal error (${event.type}): ${failureMessage}`);
                void finalize(failureMessage);
            } else if (event.type === 'execution_success' || event.type === 'execution_interrupted') {
                // The shared socket carries native terminals (the old
                // per-prompt envelope's prompt_done does not exist here) —
                // a successful/interrupted execution completes the run AFTER
                // ComfyUI's final executed outputs have been delivered.
                void finalize(null);
            }
        }
    });
}

/**
 * Build the direct NDJSON stream for one prompt off the pod's shared
 * websocket. Mirrors the removed per-prompt socket stream: the prompt_queued
 * acknowledgement leads, routed prompt events follow one per line (in
 * arrival order), and the stream ends at execution terminals (+ the
 * synthesized prompt_done envelope on success) or when the socket dies.
 */
function buildPodEventStream(connection: PodSocketConnection, ack: PodPromptAck): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let streamFinished = false;
    let unsubscribe: () => void = () => undefined;

    return new ReadableStream<Uint8Array>({
        start(controller) {
            const push = (event: StreamEvent) => {
                if (streamFinished) return;
                try {
                    controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
                } catch {
                    streamFinished = true;
                    unsubscribe();
                }
            };

            const finishStream = (terminal?: StreamEvent) => {
                if (streamFinished) return;
                streamFinished = true;
                if (terminal) {
                    try {
                        controller.enqueue(encoder.encode(JSON.stringify(terminal) + '\n'));
                    } catch {
                        // The stream is going away anyway.
                    }
                }
                try {
                    controller.close();
                } catch {
                    // Closing an already-closed stream is harmless.
                }
                unsubscribe();
            };

            // First line carries the native POST /prompt acknowledgement so
            // the client can scope following native frames to this job.
            push({
                type: 'prompt_queued',
                data: {
                    prompt_id: ack.prompt_id ?? null,
                    number: ack.number ?? null,
                    node_errors: ack.node_errors ?? {}
                }
            });

            // ComfyUI rejected the prompt at validation time: it will never
            // execute, so no execution events will ever arrive. No subscriber
            // is registered — release the pending submission count.
            const nodeErrors = ack.node_errors;
            if (nodeErrors && typeof nodeErrors === 'object' && Object.keys(nodeErrors).length > 0) {
                releasePodSubmission(connection);
                finishStream({
                    type: 'execution_error',
                    data: {
                        prompt_id: ack.prompt_id ?? null,
                        error: `Prompt validation failed: ${JSON.stringify(nodeErrors)}`,
                        node_errors: nodeErrors
                    }
                });
                return;
            }

            // The pod socket dying before subscription leaves nothing to read.
            if (connection.closed) {
                releasePodSubmission(connection);
                finishStream({
                    type: 'prompt_error',
                    data: { error: 'ComfyUI websocket closed before the prompt finished' }
                });
                return;
            }

            unsubscribe = subscribePodPrompt(connection, {
                promptId: typeof ack.prompt_id === 'string' ? ack.prompt_id : '',
                onEvent: (event) => {
                    push(event);
                    if (event.type === 'execution_error' || event.type === 'prompt_error') {
                        // prompt_error covers the registry's socket-death
                        // terminal — no final writes are possible after it.
                        finishStream();
                    } else if (event.type === 'execution_success' || event.type === 'execution_interrupted') {
                        finishStream({ type: 'prompt_done', data: {} });
                    }
                }
            });
        },

        cancel() {
            // The consumer walked away (client disconnect) — the pod keeps
            // executing, but this job's stream is no longer needed. The pod's
            // shared socket is NOT touched.
            streamFinished = true;
            unsubscribe();
        }
    });
}

/**
 * Produce a compact one-line summary of a stream event's data for the .log.
 *
 * Large payloads are reduced to a length placeholder so the log stays
 * readable and small — notably the base64 `image` data URL carried by
 * `imagepreview.update` events and the base64 file payloads carried by
 * `server_client_data` events, which can be megabytes per line.
 */
function summarizeEventData(data: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [key, val] of Object.entries(data)) {
        if (key === 'image' && typeof val === 'string') {
            // base64 data URL — never dump the payload, just its size
            parts.push(`${key}=<${val.length} chars>`);
        } else if (key === 'files' && Array.isArray(val)) {
            // server_client_data payloads — name + base64 size per file,
            // never the payload itself.
            const summaries = val.map((f) => {
                const file = (f ?? {}) as Record<string, unknown>;
                const name = typeof file.filename === 'string' && file.filename ? file.filename : '(unnamed)';
                const size = typeof file.data === 'string' ? ` <${file.data.length} chars>` : '';
                return `${name}${size}`;
            });
            parts.push(`${key}=[${summaries.join(', ')}]`);
        } else if (typeof val === 'string') {
            parts.push(`${key}=${val.length > 80 ? val.slice(0, 80) + '…' : val}`);
        } else if (typeof val === 'number' || typeof val === 'boolean') {
            parts.push(`${key}=${String(val)}`);
        } else if (val == null) {
            parts.push(`${key}=null`);
        } else {
            try {
                const j = JSON.stringify(val) ?? '';
                parts.push(`${key}=${j.length > 80 ? j.slice(0, 80) + '…' : j}`);
            } catch {
                parts.push(`${key}=?`);
            }
        }
    }
    return parts.join(' ');
}

/**
 * Convert an `imagepreview.update` event into a result item.
 * The base64 data URL is the capture-time shape — at persist time
 * (persistResultAssets) its bytes are written to an asset file on disk and
 * the stored entry keeps only a `file:` reference to it.
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
