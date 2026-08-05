// Direct-ComfyUI pod support for the cloud endpoints.
//
// Every cloud pod is the native ComfyUI server. This module owns the short
// websocket readiness check and the per-generation websocket plus native
// POST /prompt submission.
//
// A fresh client id is used for each generation because ComfyUI routes the
// execution messages for a prompt to the websocket carrying that id. This
// keeps concurrent dashboard generations isolated without a shared socket.
//
// The dashboard endpoint exposes a small NDJSON envelope around native
// websocket frames so generation persistence and the optional stream reader
// consume the same ordered data. Envelope events are named prompt_queued,
// prompt_done, and prompt_error; native ComfyUI frame types pass through.
//
// Binary preview frames follow ComfyUI's send_image wire format: an 8-byte
// big-endian header — uint32 image kind (1 = JPEG, 2 = PNG), uint32 zero
// padding — followed by the raw image bytes. ComfyUI preview binaries
// carry no node reference, so the preview is attributed to the most
// recently announced executing node, matching the server's prompt-event
// attribution convention.

import diagnosticsChannel from 'node:diagnostics_channel';
import { randomUUID } from 'node:crypto';
import { WebSocket, ping as websocketPing } from 'undici';
import type { StreamEvent } from '../workflows/generation-store';

/**
 * How long a direct-detection websocket handshake may take before the pod
 * is declared NOT a direct ComfyUI. Connection-refused answers arrive
 * effectively instantly; the timeout only covers blackholed endpoints.
 */
export const DIRECT_WS_PROBE_TIMEOUT_MS = 5_000;

// Native ComfyUI websocket handshakes need a bounded default so a direct
// prompt cannot remain pending forever when the pod disappears mid-request.
const DIRECT_SOCKET_TIMEOUT_MS = 10_000;

// Protocol-level pings make an open-but-dead upstream socket observable and
// cause the stream cleanup path to run even when the remote service vanishes
// without first emitting a browser-style close event.
export const DIRECT_WS_HEARTBEAT_MS = 10_000;

// A direct execution socket must receive either a websocket pong or an
// application message inside this window; otherwise the upstream service is
// treated as dead and the socket is cleaned up. This is intentionally much
// longer than the UI idle timer because model execution can be quiet while
// the cloud service is still healthy.
export const DIRECT_WS_RESPONSE_TIMEOUT_MS = 300_000;

// Undici exposes protocol pong notifications through this process-local
// diagnostics channel because its WebSocket surface intentionally omits a
// browser-style pong event.
const websocketPongChannel = diagnosticsChannel.channel('undici:websocket:pong');

/**
 * Per-attempt budget for the /system_stats enrichment in
 * probeDirectHealth. A hung pod must not stall the endpoint on undici's
 * 300 s default.
 */
export const DIRECT_STATS_PROBE_TIMEOUT_MS = 10_000;

// ComfyUI binary preview image kinds (server.py send_image header).
const PREVIEW_IMAGE_JPEG = 1;
const PREVIEW_IMAGE_PNG = 2;

// Preserve a pod URL's prefix path while appending a native ComfyUI route.
// This supports deployments mounted below a non-root gateway path.
function serverRoute(podUrl: URL, route: string): URL {
    const result = new URL(podUrl.toString());
    const basePath = result.pathname.replace(/\/+$/, '');
    result.pathname = `${basePath}${route}` || route;
    return result;
}

// Convert the HTTP pod URL into the native websocket URL and bind the
// request's client id so ComfyUI returns only this prompt's execution events.
function websocketUrl(podUrl: URL, clientId: string): string {
    const result = serverRoute(podUrl, '/ws');
    result.protocol = result.protocol === 'https:' ? 'wss:' : 'ws:';
    result.searchParams.set('clientId', clientId);
    return result.toString();
}

// Wait for an undici websocket to open, fail, close, or exceed its deadline.
// The ready-state check after listener registration handles synchronous/fake
// websocket implementations that transition before listeners are attached.
function waitForSocketOpen(socket: WebSocket, timeoutMs: number = DIRECT_SOCKET_TIMEOUT_MS): Promise<void> {
    if (socket.readyState === WebSocket.OPEN) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => finish(new Error('Timed out connecting to ComfyUI websocket')), timeoutMs);

        const cleanup = () => {
            clearTimeout(timer);
            socket.removeEventListener('open', onOpen);
            socket.removeEventListener('error', onError);
            socket.removeEventListener('close', onClose);
        };
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (error) reject(error);
            else resolve();
        };
        const onOpen = () => finish();
        const onError = () => finish(new Error('Unable to connect to ComfyUI websocket'));
        const onClose = () => finish(new Error('ComfyUI websocket closed before connecting'));

        socket.addEventListener('open', onOpen);
        socket.addEventListener('error', onError);
        socket.addEventListener('close', onClose);

        // A fake/test socket or synchronously completed implementation may
        // reach OPEN between construction and listener registration.
        if (socket.readyState === WebSocket.OPEN) finish();
    });
}

/** Fresh 32-char hex client id (ComfyUI's documented id shape). */
export function newDirectClientId(): string {
    return randomUUID().replace(/-/g, '');
}

/**
 * Direct-ComfyUI detection: attempt to open the native ComfyUI websocket
 * at <pod_url>/ws?clientId=<throwaway id>. True when the handshake
 * completes; false when it is refused/errors/times out and the pod is
 * unavailable for a native ComfyUI run.
 */
export async function probeDirectComfyUI(podUrl: URL, timeoutMs: number = DIRECT_WS_PROBE_TIMEOUT_MS): Promise<boolean> {
    let socket: WebSocket;
    try {
        socket = new WebSocket(websocketUrl(podUrl, newDirectClientId()));
    } catch {
        return false;
    }

    try {
        await waitForSocketOpen(socket, timeoutMs);
        return true;
    } catch {
        return false;
    } finally {
        try {
            socket.close();
        } catch {
            // Probe cleanup is best-effort only.
        }
    }
}

/**
 * Build the direct pod status document after a websocket handshake succeeds.
 * The native server has no model-list endpoint used by this dashboard, so
 * those fields remain empty while /system_stats is copied when it answers.
 * Root HTTP failure is diagnostic only because the websocket is authoritative.
 */
export async function probeDirectHealth(podUrl: URL): Promise<any> {
    let httpOk = false;
    try {
        const root = await fetch(serverRoute(podUrl, '/').toString(), {
            method: 'GET',
            headers: { Accept: 'text/html' },
            signal: AbortSignal.timeout(DIRECT_STATS_PROBE_TIMEOUT_MS)
        });
        httpOk = root.ok;
    } catch (error: any) {
        console.warn(`[cloud] Direct pod root probe failed: ${error?.message ?? String(error)}`);
    }

    let system_stats: unknown;
    try {
        const upstream = await fetch(serverRoute(podUrl, '/system_stats').toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(DIRECT_STATS_PROBE_TIMEOUT_MS)
        });
        if (upstream.ok) {
            system_stats = await upstream.json().catch(() => undefined);
        } else {
            console.warn(`[cloud] Direct pod /system_stats returned HTTP ${upstream.status}`);
        }
    } catch (err: any) {
        console.warn(`[cloud] Direct pod /system_stats probe failed: ${err?.message ?? String(err)}`);
    }

    return {
        health: {
            // The caller already completed the websocket handshake; root HTTP
            // is retained as a diagnostic signal and may fail independently.
            healthy: true,
            checked: { http_ok: httpOk, websocket: true },
            ...(system_stats !== undefined ? { system_stats } : {})
        },
        models_dir: '',
        models: {}
    };
}

export type DirectPromptAck = {
    prompt_id?: unknown;
    number?: unknown;
    node_errors?: unknown;
};

export type DirectSubmitOptions = {
    podUrl: URL;
    /** The per-request client_id the websocket + prompt submission share. */
    clientId: string;
    /** The full POST /prompt payload (prompt already converted to API format). */
    promptPayload: Record<string, unknown>;
    /** Forwarded Authorization header for authenticated pods. */
    authorization?: string;
};

/**
 * Submit a prompt to a direct ComfyUI pod.
 *
 * Opens the native websocket under `clientId`, POSTs the prompt to the
 * native /prompt endpoint. When the pod rejects the submission (non-2xx),
 * its native Response is handed back for the shared error path; when
 * accepted, the Response carries an application/x-ndjson direct event stream.
 *
 * Throws (socket handshake refused, network failure, malformed ack) for
 * the same 502 / failed-generation handling the native fetch exception
 * receives.
 */
export async function submitDirectPrompt(options: DirectSubmitOptions): Promise<Response> {
    const { podUrl, clientId, promptPayload, authorization } = options;

    // The websocket is opened BEFORE POST /prompt so ComfyUI cannot emit
    // an execution event before this server starts reading it.
    const socket = new WebSocket(websocketUrl(podUrl, clientId));
    try {
        await waitForSocketOpen(socket);
    } catch (err: any) {
        try {
            socket.close();
        } catch {
            // The original handshake error is the useful one.
        }
        throw new Error(`Failed to open ComfyUI websocket: ${err?.message ?? String(err)}`);
    }

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json'
    };
    if (authorization) {
        headers['Authorization'] = authorization;
    }

    let upstream: Response;
    try {
        upstream = await fetch(serverRoute(podUrl, '/prompt').toString(), {
            method: 'POST',
            headers,
            // Enforce the socket/prompt client_id pairing — ComfyUI routes
            // this prompt's execution events ONLY to the websocket whose
            // client_id submitted it, which is the socket opened above.
            body: JSON.stringify({ ...promptPayload, client_id: clientId })
        });
    } catch (err) {
        try {
            socket.close();
        } catch {
            // The fetch error is the useful one.
        }
        throw err;
    }

    if (!upstream.ok) {
        // Relay the pod's own native error response so the caller can expose
        // ComfyUI's validation details without rewriting them.
        try {
            socket.close();
        } catch {
            // Socket cleanup is best-effort only.
        }
        return upstream;
    }

    let ack: DirectPromptAck;
    try {
        ack = (await upstream.json()) as DirectPromptAck;
    } catch {
        try {
            socket.close();
        } catch {
            // Socket cleanup is best-effort only.
        }
        throw new Error(`ComfyUI POST /prompt returned HTTP ${upstream.status} with a non-JSON body`);
    }

    // The service can close the socket while POST /prompt is still returning
    // its acknowledgement. Do not create a stream with a socket that already
    // missed its close event before the stream listeners were attached.
    if (socket.readyState !== WebSocket.OPEN) {
        try {
            socket.close();
        } catch {
            // Socket cleanup is best-effort; the closed state is already known.
        }
        throw new Error('ComfyUI websocket closed before the prompt stream started');
    }

    const stream = buildDirectStream(socket, ack);
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' }
    });
}

/**
 * Build the direct NDJSON stream from one open ComfyUI websocket. Message
 * handling is chained so lines are enqueued strictly in
 * arrival order (binary preview decoding is async); the chain also
 * guarantees previews that precede a terminal event are written before the
 * stream ends.
 */
function buildDirectStream(socket: WebSocket, ack: DirectPromptAck): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let streamFinished = false;
    let socketCleanedUp = false;
    let lastExecutingNode: string | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let lastServerResponseAt = Date.now();
    let pongListener: ((message: unknown) => void) | null = null;
    // Assigned when the stream starts so cancellation uses the same cleanup
    // path as remote close, heartbeat timeout, and write failure.
    let cleanupSocket = () => undefined;

    return new ReadableStream<Uint8Array>({
        start(controller) {
            // Keep timer, diagnostics subscription, and socket disposal in one
            // closure so every cleanup path releases all resources once.
            cleanupSocket = () => {
                if (socketCleanedUp) return;
                socketCleanedUp = true;
                if (heartbeatTimer !== null) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                if (pongListener !== null) {
                    websocketPongChannel.unsubscribe(pongListener);
                    pongListener = null;
                }
                try {
                    socket.close();
                } catch {
                    // Socket cleanup is best-effort after a remote failure.
                }
            };

            // A pong is the protocol-level proof that the upstream service is
            // alive; application frames also count because they prove the same
            // socket is still delivering ComfyUI data.
            pongListener = (message: unknown) => {
                const event = message as { websocket?: WebSocket };
                if (event.websocket === socket) lastServerResponseAt = Date.now();
            };
            websocketPongChannel.subscribe(pongListener);

            const push = (event: StreamEvent) => {
                if (streamFinished) return;
                try {
                    controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
                } catch {
                    streamFinished = true;
                    cleanupSocket();
                }
            };

            // Close only the dashboard-facing NDJSON stream. The upstream
            // ComfyUI websocket remains alive after execution terminals so
            // ComfyUI can finish its own final writes.
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
            };

            // Upstream failure is different from a normal execution terminal:
            // it must finish the caller and immediately dispose the socket.
            const failStream = (terminal: StreamEvent) => {
                finishStream(terminal);
                cleanupSocket();
            };

            // A close can race the HTTP acknowledgement and happen before
            // the event listeners below are installed. Emit one terminal
            // failure immediately instead of leaving the response hanging.
            if (socket.readyState !== WebSocket.OPEN) {
                push({
                    type: 'prompt_queued',
                    data: {
                        prompt_id: ack.prompt_id ?? null,
                        number: ack.number ?? null,
                        node_errors: ack.node_errors ?? {}
                    }
                });
                failStream({ type: 'prompt_error', data: { error: 'ComfyUI websocket closed before the prompt finished' } });
                return;
            }

            // First line carries the native POST /prompt acknowledgement so
            // the server can scope following native frames to this job.
            push({
                type: 'prompt_queued',
                data: {
                    prompt_id: ack.prompt_id ?? null,
                    number: ack.number ?? null,
                    node_errors: ack.node_errors ?? {}
                }
            });

            // ComfyUI rejected the prompt at validation time: it will never
            // execute, so no execution events will ever arrive. Emit the
            // failure on the terminal event consumers already stop at.
            const nodeErrors = ack.node_errors;
            if (nodeErrors && typeof nodeErrors === 'object' && Object.keys(nodeErrors).length > 0) {
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

            // Ping at a bounded cadence and verify the socket remains open.
            // Undici handles pong frames internally; a failed write or a
            // transition to CLOSING/CLOSED enters the same terminal cleanup
            // path as an explicit service close/error event.
            heartbeatTimer = setInterval(() => {
                if (socket.readyState !== WebSocket.OPEN) {
                    failStream({ type: 'prompt_error', data: { error: 'ComfyUI websocket stopped responding' } });
                    return;
                }
                if (Date.now() - lastServerResponseAt >= DIRECT_WS_RESPONSE_TIMEOUT_MS) {
                    failStream({
                        type: 'prompt_error',
                        data: {
                            error: `ComfyUI websocket stopped responding for ${DIRECT_WS_RESPONSE_TIMEOUT_MS / 1000}s`
                        }
                    });
                    return;
                }
                try {
                    websocketPing(socket);
                } catch (error) {
                    failStream({
                        type: 'prompt_error',
                        data: { error: `ComfyUI websocket stopped responding: ${error instanceof Error ? error.message : String(error)}` }
                    });
                }
            }, DIRECT_WS_HEARTBEAT_MS);
            // The stream's close/error events own cleanup; an unref prevents a
            // forgotten consumer from keeping the Node process alive forever.
            const unref = (heartbeatTimer as unknown as { unref?: () => void }).unref;
            if (typeof unref === 'function') unref.call(heartbeatTimer);

            const handleMessage = async (data: unknown): Promise<void> => {
                if (socketCleanedUp) return;
                lastServerResponseAt = Date.now();
                if (streamFinished) return;

                if (typeof data === 'string') {
                    let message: { type?: unknown; data?: unknown };
                    try {
                        message = JSON.parse(data) as { type?: unknown; data?: unknown };
                    } catch {
                        return; // malformed text frame — nothing to forward
                    }

                    const type = typeof message?.type === 'string' ? message.type : 'raw';
                    const eventData =
                        message?.data && typeof message.data === 'object'
                            ? (message.data as Record<string, unknown>)
                            : {};

                    // Track the executing node so following binary preview
                    // frames can be attributed to it.
                    if (type === 'executing') {
                        const node = eventData.node;
                        if (typeof node === 'string' && node) lastExecutingNode = node;
                    }

                    push({ type, data: eventData });

                    if (type === 'execution_success' || type === 'execution_interrupted') {
                        // The response is complete, but the native socket is
                        // deliberately left open until ComfyUI closes it or
                        // the five-minute response watchdog expires.
                        finishStream({ type: 'prompt_done', data: {} });
                    } else if (type === 'execution_error') {
                        // execution_error is itself the terminal event every
                        // consumer stops at — close only the client stream.
                        finishStream();
                    }
                    return;
                }

                // Binary frame — ComfyUI preview images (8-byte big-endian
                // header + raw image bytes).
                const bytes = await frameBytes(data);
                if (!bytes || bytes.length < 8 || streamFinished) return;
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
                const imageKind = view.getUint32(0, false);
                const mime =
                    imageKind === PREVIEW_IMAGE_JPEG ? 'image/jpeg' : imageKind === PREVIEW_IMAGE_PNG ? 'image/png' : null;
                if (!mime) return;
                const payload = bytes.subarray(8);
                if (payload.length === 0) return;

                push({
                    type: 'imagepreview.update',
                    data: {
                        node_id: lastExecutingNode ?? '',
                        image: `data:${mime};base64,${Buffer.from(payload).toString('base64')}`
                    }
                });
            };

            // Serialize message handling: NDJSON lines must be enqueued in
            // arrival order, and previews preceding a terminal event must
            // land before the stream ends.
            let chain: Promise<void> = Promise.resolve();
            socket.addEventListener('message', (event) => {
                chain = chain.then(() => handleMessage((event as MessageEvent).data)).catch(() => {
                    // A dropped frame must not kill the stream.
                });
            });

            socket.addEventListener('close', () => {
                failStream({ type: 'prompt_error', data: { error: 'ComfyUI websocket closed before the prompt finished' } });
            });
            socket.addEventListener('error', () => {
                failStream({ type: 'prompt_error', data: { error: 'ComfyUI websocket errored before the prompt finished' } });
            });
        },

        cancel() {
            // The consumer walked away (client disconnect / aborted
            // background read) — the pod keeps executing, but this job's
            // socket is no longer needed.
            streamFinished = true;
            cleanupSocket();
        }
    });
}

/** Normalize one websocket binary frame to bytes (undici delivers Buffer/Blob/ArrayBuffer). */
async function frameBytes(data: unknown): Promise<Uint8Array | null> {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return null;
}
