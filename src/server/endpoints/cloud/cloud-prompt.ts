// Cloud prompt endpoint — POST /v1/comfy/cloud/prompt
//
// Two modes:
//
// 1) Server-side processing — body includes `workflow_id` + `generation_id`.
//    The server submits the prompt to the pod, consumes the NDJSON stream
//    in the background, and keeps the generation json file updated by
//    itself (status → processing/completed/failed, results, timing
//    — same file the workflow generation API writes). The event progression
//    is traced line-by-line into the sibling .log file — the raw events are
//    intentionally NOT stored in the json. The client gets an
//    immediate 202 and observes progress by polling
//    GET /v1/comfy/workflows/:id/generate.
//
// 2) Direct stream mode — no workflow reference.
//    The native websocket event stream is returned as application/x-ndjson
//    for callers that need to observe a run directly.
//
// Common request fields (mirrors beam_comfy_service PromptRequest schema):
//   - pod_url:   the native ComfyUI pod URL
//   - prompt:    the ORIGINAL workflow json snapshot (v0.4/v1 editor format
//                — what the dashboard stores on every generation). Converted
//                to the flat API prompt HERE, server-side, right before it
//                goes out to the Comfy Cloud pod — the one place conversion
//                happens, so stored documents stay lossless.
//   - client_id: accepted for compatibility and ignored; every request gets
//                a fresh native websocket client id
//   - extra_data: passed through to ComfyUI's POST /prompt extra_data
//   - front / number: forwarded to ComfyUI POST /prompt
//

import { asHandlerMethod } from '@underload/service';
import { newDirectClientId, submitDirectPrompt } from './direct-comfy';
import { workflowToApiPrompt } from '../../../frontend/features/workflow/components/utils/workflow-prompt';
import { extractServerClientDataResults } from '../../../frontend/features/workflow/components/utils/stream-results';
import {
    appendGenerationLog,
    patchGenerationFile,
    persistResultAssets,
    type GenerationResultItem,
    type StreamEvent
} from '../workflows/generation-store';

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

    // Every request owns a fresh native websocket client id. The direct
    // transport uses this value in both the websocket URL and POST /prompt.
    const directClientId = newDirectClientId();
    const submission = {
        origin: `${podUrl.toString()} (ComfyUI websocket)`,
        clientId: directClientId
    };
    const submit = (): Promise<Response> =>
        submitDirectPrompt({ podUrl, clientId: directClientId, promptPayload, authorization });

    // ── Mode 1: server-side processing ──────────────────────────────
    // The client submits and is done — the server owns the pod stream
    // and the generation json from here on.
    if (body.workflow_id && body.generation_id) {
        const root = _variables?.root as string | undefined;
        if (!root) {
            return { status: 500, response: { error: 'Server misconfigured: missing project root' } };
        }

        // The native client id was generated before this asynchronous branch,
        // so the accepted response, websocket, and generation log correlate.
        const clientId = directClientId;

        // Fire-and-forget — intentionally not awaited. The function never
        // rejects; all failures land in the generation file.
        void processPodPromptInBackground(
            root,
            body.workflow_id,
            body.generation_id,
            submission,
            submit
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

    // ── Mode 2: direct websocket event stream ────────────────────────
    try {
        const upstream = await submit();

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
        console.error(`[cloud/prompt] Error connecting to ${body.pod_url}:`, err.message);
        return {
            status: 502,
            response: { error: `Failed to reach pod: ${err.message}` },
        };
    }
});

// ── Server-side background processing ───────────────────────────────

/**
 * Submit the prompt to the pod, consume its NDJSON stream, and persist
 * the outcome (status, results, timing, error) into the generation json
 * file. The event stream itself is traced into the sibling .log file only.
 * Never throws — failures are recorded in the generation entry itself.
 *
 * The pod-facing submission opens the native ComfyUI websocket before POST
 * /prompt and resolves to a Response whose NDJSON body this function reads.
 * `submission` records the direct URL and client id for the generation log.
 */
async function processPodPromptInBackground(
    root: string,
    workflowId: string,
    generationId: string,
    submission: { origin: string; clientId?: string },
    submit: () => Promise<Response>
): Promise<void> {
    const startedAt = Date.now();
    const results: GenerationResultItem[] = [];
    let failureMessage: string | null = null;
    let eventCount = 0;

    // Append a timestamped line to <generationId>.log (next to the .json)
    // at every status change and streamed event. Best-effort — never throws.
    // Fire-and-forget: appends are chained per log file inside the store,
    // so rapid event bursts still land in strict chronological order while
    // the NDJSON reader never waits on disk.
    const log = (message: string) =>
        void appendGenerationLog(root, workflowId, generationId, message);

    log(`Generation started — submitting to ${submission.origin} (client_id: ${submission.clientId ?? 'n/a'})`);

    try {
        // Mark the generation as picked up so pollers see live progress
        const patched = await patchGenerationFile(root, workflowId, generationId, { status: 'processing' });
        if (!patched) {
            log(`Generation '${generationId}' not found — aborting background processing`);
            console.warn(`[cloud/prompt] Generation '${generationId}' not found — aborting background processing`);
            return;
        }

        const upstream = await submit();
        log(`Pod responded HTTP ${upstream.status}`);

        if (!upstream.ok) {
            const errorBody = await upstream
                .json()
                .catch(() => ({ error: `Pod returned HTTP ${upstream.status}` }));
            failureMessage =
                (errorBody as { error?: string })?.error ?? `Pod returned HTTP ${upstream.status}`;
            log(`Pod error response: ${failureMessage}`);
        } else {
            const outcome = await consumeNdjsonStream(upstream, results, log);
            failureMessage = outcome.failure;
            eventCount = outcome.eventCount;
        }
    } catch (err: any) {
        failureMessage = err.message ?? String(err);
        log(`Exception while processing: ${failureMessage}`);
    }

    // Persist the final state — results into the generation json. Result
    // payloads (base64 data: urls captured from the stream) are first moved
    // onto disk as plain asset files; the json keeps only `file:` references
    // to them (persistResultAssets). The event progression is NOT stored:
    // the .log file next to the json already carries the full chronological
    // trail (a line per status change and per streamed event), which is
    // sufficient to understand the run.
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
            `[cloud/prompt] Generation ${generationId} (workflow ${workflowId}, client ${submission.clientId}) completed ` +
            `in ${elapsed} — ${eventCount} stream event(s), ${results.length} result(s)`
        );
    }
}

/**
 * Read the pod's NDJSON response to completion, capturing image previews
 * into `results` and counting events.
 * Returns `{ failure, eventCount }` — failure is the native execution_error
 * or direct connection error message, else null.
 *
 * Every event is appended to the generation's .log (via `log`), which is
 * the chronological, human-readable trail of the run. Events are NOT
 * persisted into the generation json — the .log is sufficient.
 */
async function consumeNdjsonStream(
    upstream: Response,
    results: GenerationResultItem[],
    log: (message: string) => void
): Promise<{ failure: string | null; eventCount: number }> {
    const reader = (upstream.body as ReadableStream<Uint8Array> | null)?.getReader();
    if (!reader) {
        log('Pod returned an empty body — no stream to consume');
        return { failure: 'Pod returned an empty body', eventCount: 0 };
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let failureMessage: string | null = null;
    let eventCount = 0;

    // ── Job scoping (client_id → prompt_id) ─────────────────────────
    // Several generations may share the pod at once; ComfyUI broadcasts
    // every execution event to all websocket subscribers, so this stream
    // can receive events belonging to OTHER jobs. Our submission's
    // prompt_id is learned from the prompt_queued acknowledgement; from
    // then on, any event carrying a DIFFERENT prompt_id is dropped.
    // Events without a prompt_id (status broadcasts, prompt_done, preview
    // frames) cannot be attributed that way and are kept — prompt_done is
    // emitted per direct subscription, so the stream still ends when this
    // client id's job finishes.
    let ourPromptId: string | null = null;

    /** Returns true when the event is terminal (stop reading). */
    const handleEvent = (event: StreamEvent): boolean => {
        if (event.type === 'prompt_queued') {
            const pid = (event.data as Record<string, unknown>)?.prompt_id;
            if (typeof pid === 'string') {
                ourPromptId = pid;
                log(`Enqueued — prompt_id: ${pid}`);
            }
        } else {
            const pid = (event.data as Record<string, unknown>)?.prompt_id;
            if (ourPromptId && typeof pid === 'string' && pid !== ourPromptId) {
                return false; // another job's event on this shared pod — ignore
            }
        }

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
            failureMessage =
                (data?.exception_message as string) ??
                (data?.error as string) ??
                `Generation failed (${event.type})`;
            log(`Terminal error (${event.type}): ${failureMessage}`);
            return true;
        }
        if (event.type === 'prompt_done') {
            log('prompt_done — stream ending');
            return true;
        }
        return false;
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
                    log('Skipping malformed NDJSON line');
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

    return { failure: failureMessage, eventCount };
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
