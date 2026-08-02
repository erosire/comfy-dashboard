// Direct-ComfyUI pod support for the cloud endpoints.
//
// A pod_url handed back by the spawner (or probed via POST /v1/comfy/cloud)
// can point at one of two backend shapes:
//
//   - Tier 2 proxy (ComfyProxy): GET / returns a JSON
//     {health, models_dir, models} document and POST / executes a prompt
//     while streaming progress back as NDJSON. There is no reachable
//     ComfyUI websocket on that URL — the handshake is refused.
//
//   - Direct ComfyUI: the pod_url IS the ComfyUI server. GET / serves the
//     ComfyUI frontend HTML (not JSON), but it answers the native
//     endpoints: GET /system_stats, POST /prompt, and the websocket at
//     /ws?clientId=<id>.
//
// Detection (probeDirectComfyUI) is exactly that websocket handshake:
// if the connection can be opened the pod is a direct ComfyUI; a refused /
// failed / timed-out handshake means it is not.
//
// Prompt submission (submitDirectPrompt) drives the native protocol —
// open /ws under a FRESH client_id per request (ComfyUI routes a prompt's
// execution events only to the websocket whose client_id submitted it, so
// a per-request socket gives every job its own stream with no cross-talk),
// then POST /prompt. The received websocket messages are translated into
// the SAME NDJSON event vocabulary the Tier 2 proxy emits, so every
// downstream consumer (server-side generation processing, legacy client
// streaming) is shared, unchanged, with the proxy flow:
//
//   ComfyUI ws message                      →  stream event
//   POST /prompt ack                        →  proxy_enqueue {prompt_id, number, node_errors}
//   any JSON frame {type, data}             →  passed through unchanged
//   binary preview frame (8-byte header)    →  imagepreview.update {node_id, image: data:<mime>;base64,…}
//   execution_success / execution_interrupted  →  event, then proxy_done
//   execution_error                         →  event, then stream end (terminal for consumers)
//   node_errors in the POST ack             →  proxy_enqueue, then execution_error, then end
//   socket closed / errored before the end  →  proxy_error {error}, then end
//
// Binary preview frames follow ComfyUI's send_image wire format: an 8-byte
// big-endian header — uint32 image kind (1 = JPEG, 2 = PNG), uint32 zero
// padding — followed by the raw image bytes. ComfyUI preview binaries
// carry no node reference, so the preview is attributed to the most
// recently announced executing node (same convention the connect endpoint
// uses for prompt attribution).

import { randomUUID } from 'node:crypto';
import { WebSocket } from 'undici';
import { serverRoute, waitForSocketOpen, websocketUrl } from '../connect';
import type { StreamEvent } from '../workflows/generation-store';

/**
 * How long a direct-detection websocket handshake may take before the pod
 * is declared NOT a direct ComfyUI. Connection-refused answers arrive
 * effectively instantly; the timeout only covers blackholed endpoints.
 */
export const DIRECT_WS_PROBE_TIMEOUT_MS = 5_000;

// ComfyUI binary preview image kinds (server.py send_image header).
const PREVIEW_IMAGE_JPEG = 1;
const PREVIEW_IMAGE_PNG = 2;

/** Fresh 32-char hex client id (ComfyUI's documented id shape). */
export function newDirectClientId(): string {
    return randomUUID().replace(/-/g, '');
}

/**
 * Direct-ComfyUI detection: attempt to open the native ComfyUI websocket
 * at <pod_url>/ws?clientId=<throwaway id>. True when the handshake
 * completes; false when it is refused/errors/times out (i.e. the pod_url
 * fronts a proxy, or the pod is unreachable).
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
 * Submit a prompt to a DIRECT ComfyUI pod (is_direct: true flow).
 *
 * Opens the native websocket under `clientId`, POSTs the prompt to the
 * native /prompt endpoint, and returns a Response shaped exactly like the
 * Tier 2 proxy's: when the pod rejects the submission (non-2xx) its real
 * Response is handed back for the shared !ok error path; when accepted,
 * the Response carries a synthesized application/x-ndjson body that the
 * shared consumers read identically to a proxy stream.
 *
 * Throws (socket handshake refused, network failure, malformed ack) for
 * the same 502 / failed-generation handling the proxy flow's fetch
 * exception receives.
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
        // Relay the pod's own error response — the caller's shared !ok
        // handling consumes it exactly like a proxy response.
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

    const stream = buildDirectStream(socket, ack);
    return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' }
    });
}

/**
 * Synthesize the proxy-vocabulary NDJSON stream from one open ComfyUI
 * websocket. Message handling is chained so lines are enqueued strictly in
 * arrival order (binary preview decoding is async); the chain also
 * guarantees previews that precede a terminal event are written before the
 * stream ends.
 */
function buildDirectStream(socket: WebSocket, ack: DirectPromptAck): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    let finished = false;
    let lastExecutingNode: string | null = null;

    return new ReadableStream<Uint8Array>({
        start(controller) {
            const push = (event: StreamEvent) => {
                if (finished) return;
                try {
                    controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
                } catch {
                    finished = true;
                }
            };

            const end = (terminal?: StreamEvent) => {
                if (finished) return;
                finished = true;
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
                try {
                    socket.close();
                } catch {
                    // Socket cleanup is best-effort only.
                }
            };

            // First line — mirrors the proxy's enqueue acknowledgement so
            // shared consumers learn this job's prompt_id exactly as before.
            push({
                type: 'proxy_enqueue',
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
                end({
                    type: 'execution_error',
                    data: {
                        prompt_id: ack.prompt_id ?? null,
                        error: `Prompt validation failed: ${JSON.stringify(nodeErrors)}`,
                        node_errors: nodeErrors
                    }
                });
                return;
            }

            const handleMessage = async (data: unknown): Promise<void> => {
                if (finished) return;

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
                        end({ type: 'proxy_done', data: {} });
                    } else if (type === 'execution_error') {
                        // execution_error is itself the terminal event every
                        // consumer stops at — close the stream after it.
                        end();
                    }
                    return;
                }

                // Binary frame — ComfyUI preview images (8-byte big-endian
                // header + raw image bytes).
                const bytes = await frameBytes(data);
                if (!bytes || bytes.length < 8 || finished) return;
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
                end({ type: 'proxy_error', data: { error: 'ComfyUI websocket closed before the prompt finished' } });
            });
            socket.addEventListener('error', () => {
                end({ type: 'proxy_error', data: { error: 'ComfyUI websocket errored before the prompt finished' } });
            });
        },

        cancel() {
            // The consumer walked away (client disconnect / aborted
            // background read) — the pod keeps executing, but this job's
            // socket is no longer needed.
            finished = true;
            try {
                socket.close();
            } catch {
                // Socket cleanup is best-effort only.
            }
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
