// Persistent cloud-pod websocket registry — ONE websocket per cloud pod.
//
// Pods are spawned via POST /v1/comfy/cloud (cloud.ts). That endpoint only
// answers AFTER connectPodSocket() resolves: the pod's native ComfyUI
// websocket is open and registered here. The connection then lives in
// SERVER MEMORY FOREVER — until the cloud server terminates it (remote
// close/error). On termination the pod drops out of the registry and every
// in-flight prompt subscriber receives a terminal `prompt_error` event, so
// its generation lands failed with the .log trail intact.
//
// ComfyUI routes a prompt's execution messages to the websocket whose
// clientId submitted it (server.py send_sync sid), so every POST /prompt
// goes out with the pod-level clientId and ALL of a pod's events arrive on
// this single socket. The registry demultiplexes by prompt_id:
//   - event.data.prompt_id == subscriber.promptId → that subscriber only;
//   - prompt_id with NO subscriber yet            → buffered (a fast
//     execution can outrun the HTTP ack → subscribe registration path) and
//     flushed on subscribe;
//   - no prompt_id (status broadcasts, …)         → every subscriber,
//     mirroring the old per-prompt socket consumers (cloud-prompt.ts).
//
// Binary preview frames follow ComfyUI's send_image wire format: an 8-byte
// big-endian header — uint32 image kind (1 = JPEG, 2 = PNG), uint32 zero
// padding — followed by the raw image bytes. Previews carry no prompt/node
// reference, so each is stamped with the most recent executing
// {node, prompt_id} before routing (the same attribution convention the
// removed per-prompt buildDirectStream used).
//
// Every event delivered for a known prompt_id is ultimately traced into
// that prompt's generation .log file by the subscriber in cloud-prompt.ts
// (one log per prompt) — the registry itself is storage-agnostic.
//
// Used by:
//   - cloud.ts        — create (connect + hold) / status (adopt-or-report)
//                       / GET list (listPodSockets)
//   - cloud-prompt.ts — prompt submission over the shared socket
//                       (submitPodPrompt + subscribePodPrompt)

import { ping as websocketPing, WebSocket } from 'undici';
import {
    newDirectClientId,
    serverRoute,
    waitForSocketOpen,
    websocketUrl
} from './direct-comfy';
import type { StreamEvent } from '../workflows/generation-store';

/**
 * How long the persistent-socket handshake may take before pod creation is
 * declared failed. Freshly spawned pods can still be booting ComfyUI when
 * the spawner's 302 lands, so this is intentionally more patient than the
 * old 5 s throwaway probe (which returned immediately with an error field).
 */
export const POD_WS_OPEN_TIMEOUT_MS = 30_000;

/**
 * Protocol-level ping cadence for the persistent socket. A failed write or
 * a non-OPEN readyState terminates the connection (and every prompt riding
 * it). There is deliberately NO response-silence watchdog here — an idle
 * pod is quiet by nature, and the connection must live until the cloud
 * server ends it.
 */
export const POD_WS_HEARTBEAT_MS = 10_000;

/**
 * Cap on buffered events held for a prompt_id with no subscriber yet. The
 * buffer exists only to absorb the ack → subscribe race; 200 lines is far
 * beyond what a prompt can emit inside that window. Oldest lines drop first.
 */
const MAX_BUFFERED_EVENTS_PER_PROMPT = 200;

// ComfyUI binary preview image kinds (server.py send_image header).
const PREVIEW_IMAGE_JPEG = 1;
const PREVIEW_IMAGE_PNG = 2;

/**
 * A registered consumer of one prompt's events on the shared socket. The
 * promptId is the ONLY routing key: every event carrying a matching
 * data.prompt_id is delivered here; so are events with no prompt_id at all
 * (status broadcasts), mirroring the removed per-prompt socket consumers.
 */
export type PodPromptSubscriber = {
    id: string;
    promptId: string;
    onEvent: (event: StreamEvent) => void;
};

/** One persistent pod connection — the unit the registry memoizes. */
export type PodSocketConnection = {
    /** Registry key — the normalized pod URL (URL.toString(), trailing /). */
    key: string;
    podUrl: URL;
    /**
     * The pod-level client id shared by the websocket AND every POST
     * /prompt: ComfyUI routes each prompt's execution messages to the
     * socket whose clientId submitted it, so reusing one id is what makes
     * the single-socket design work.
     */
    clientId: string;
    /** Spawn-time metadata echoed by GET /v1/comfy/cloud (best-effort). */
    gpu?: string;
    name?: string;
    /** ISO timestamp of the (re)connection — diagnostics for the GET list. */
    connectedAt: string;
    socket: WebSocket;
    /** Live prompt consumers keyed by subscriber id. */
    subscribers: Map<string, PodPromptSubscriber>;
    /**
     * Submissions between POST /prompt and their subscribePodPrompt call.
     * Counted in the GET list's `prompts` so the brief gap stays visible.
     */
    pendingSubmissions: number;
    /**
     * Events received for prompt_ids with no subscriber yet, keyed by
     * prompt_id. Flushed on subscribe; cleared on terminate.
     */
    buffered: Map<string, StreamEvent[]>;
    /** Liveness interval handle — needed by closeAllPodSockets teardown. */
    heartbeat: ReturnType<typeof setInterval> | null;
    /** Set once the socket closes/errors — the connection is terminal. */
    closed: boolean;
};

/** GET /v1/comfy/cloud entry — one active pod with its in-flight count. */
export type PodSocketInfo = {
    pod_url: string;
    gpu?: string;
    name?: string;
    client_id: string;
    /** The pod's server-managed websocket is currently open. */
    active: boolean;
    /** Prompts currently being processed by this pod (all subscribers). */
    prompts: number;
    connectedAt: string;
};

// The registry itself: normalized pod URL → its one persistent connection.
const podSockets = new Map<string, PodSocketConnection>();

// URL normalization shared by every lookup — URL.toString() adds the
// trailing slash to a bare host, so "https://pod.example" and
// "https://pod.example/" resolve to the same pod.
function podKey(podUrl: URL | string): string {
    return new URL(String(podUrl)).toString();
}

/**
 * Connect (or reuse) the pod's ONE persistent websocket. A healthy existing
 * connection is returned as-is (spawn metadata refreshed); a stale one is
 * replaced. Throws when the handshake fails — the caller (create endpoint)
 * then refuses to return the pod.
 */
export async function connectPodSocket(
    podUrl: URL,
    meta?: { gpu?: string; name?: string }
): Promise<PodSocketConnection> {
    const key = podKey(podUrl);
    const existing = podSockets.get(key);
    if (existing && !existing.closed && existing.socket.readyState === WebSocket.OPEN) {
        if (meta?.gpu !== undefined) existing.gpu = meta.gpu;
        if (meta?.name !== undefined) existing.name = meta.name;
        return existing;
    }
    if (existing) podSockets.delete(key);

    const clientId = newDirectClientId();
    const socket = new WebSocket(websocketUrl(podUrl, clientId));
    try {
        await waitForSocketOpen(socket, POD_WS_OPEN_TIMEOUT_MS);
    } catch (error) {
        try {
            socket.close();
        } catch {
            // The handshake error is the useful one.
        }
        throw error;
    }

    const connection = buildConnection(key, new URL(String(podUrl)), clientId, socket, meta);
    podSockets.set(key, connection);
    return connection;
}

/**
 * The pod's live connection, or null when the pod is unknown / its socket
 * terminated. cloud-prompt.ts gates on this — unknown pods are rejected,
 * never reconnected (only the create/status endpoint adopts pods).
 */
export function getPodSocket(podUrl: URL | string): PodSocketConnection | null {
    let key: string;
    try {
        key = podKey(podUrl);
    } catch {
        return null;
    }
    const connection = podSockets.get(key);
    if (!connection || connection.closed || connection.socket.readyState !== WebSocket.OPEN) {
        return null;
    }
    return connection;
}

/** GET /v1/comfy/cloud payload — every registered pod, most recent first not guaranteed. */
export function listPodSockets(): PodSocketInfo[] {
    const pods: PodSocketInfo[] = [];
    for (const connection of podSockets.values()) {
        if (connection.closed) continue;
        pods.push({
            pod_url: connection.key,
            gpu: connection.gpu,
            name: connection.name,
            client_id: connection.clientId,
            active: connection.socket.readyState === WebSocket.OPEN,
            prompts: connection.subscribers.size + connection.pendingSubmissions,
            connectedAt: connection.connectedAt
        });
    }
    return pods;
}

/**
 * Terminate every registered pod — process teardown and tests. Subscribers
 * are NOT evented (this is a server-level shutdown, not a pod failure).
 */
export function closeAllPodSockets(): void {
    for (const connection of podSockets.values()) {
        connection.closed = true;
        if (connection.heartbeat !== null) clearInterval(connection.heartbeat);
        try {
            connection.socket.close();
        } catch {
            // Best-effort teardown.
        }
        connection.subscribers.clear();
        connection.buffered.clear();
    }
    podSockets.clear();
}

export type PodPromptAck = {
    prompt_id?: unknown;
    number?: unknown;
    node_errors?: unknown;
};

/**
 * Submit one prompt over the pod's HTTP endpoint, bound to the shared
 * socket's clientId (so its execution messages land on the persistent
 * socket). NEVER opens a websocket — the registry's single connection is
 * the only event source.
 *
 * Returns the native Response (for non-2xx relay) plus the parsed ack when
 * available. Throws on network failure / non-JSON success body, matching
 * the old transport's 502 handling.
 */
export async function submitPodPrompt(
    connection: PodSocketConnection,
    options: { promptPayload: Record<string, unknown>; authorization?: string }
): Promise<{ response: Response; ack: PodPromptAck | null }> {
    connection.pendingSubmissions += 1;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json'
    };
    if (options.authorization) headers['Authorization'] = options.authorization;

    let response: Response;
    try {
        response = await fetch(serverRoute(connection.podUrl, '/prompt').toString(), {
            method: 'POST',
            headers,
            // Enforce the socket/prompt client_id pairing — ComfyUI routes
            // this prompt's execution events ONLY to the persistent socket.
            body: JSON.stringify({ ...options.promptPayload, client_id: connection.clientId })
        });
    } catch (error) {
        connection.pendingSubmissions -= 1;
        throw error;
    }

    if (!response.ok) {
        connection.pendingSubmissions -= 1;
        return { response, ack: null };
    }

    let ack: PodPromptAck;
    try {
        ack = (await response.json()) as PodPromptAck;
    } catch {
        connection.pendingSubmissions -= 1;
        throw new Error(`ComfyUI POST /prompt returned HTTP ${response.status} with a non-JSON body`);
    }
    // The pending count transfers into the subscriber count at subscribe.
    return { response, ack };
}

/**
 * Register a prompt_id consumer on the shared socket. Any events buffered
 * for this prompt_id before registration (the ack → subscribe race) are
 * flushed in a microtask so the caller's local state (e.g. its unsubscribe
 * binding) settles first. Returns the unsubscribe function.
 */
export function subscribePodPrompt(
    connection: PodSocketConnection,
    subscriber: { promptId: string; onEvent: (event: StreamEvent) => void }
): () => void {
    const id = newDirectClientId();
    connection.subscribers.set(id, { id, ...subscriber });
    connection.pendingSubmissions = Math.max(0, connection.pendingSubmissions - 1);

    const early = connection.buffered.get(subscriber.promptId);
    if (early) {
        connection.buffered.delete(subscriber.promptId);
        // Deferred so a terminal event inside the flush cannot fire before
        // the caller received its unsubscribe handle.
        queueMicrotask(() => early.forEach((event) => subscriber.onEvent(event)));
    }

    return () => {
        connection.subscribers.delete(id);
    };
}

/**
 * Balance submitPodPrompt's pending count when the caller finalizes the run
 * WITHOUT subscribing (prompt rejected at validation time via node_errors,
 * or the socket died before subscription) — keeps the GET list's `prompts`
 * count honest.
 */
export function releasePodSubmission(connection: PodSocketConnection): void {
    connection.pendingSubmissions = Math.max(0, connection.pendingSubmissions - 1);
}

// ── Connection construction & event demultiplexing ─────────────────────

function buildConnection(
    key: string,
    podUrl: URL,
    clientId: string,
    socket: WebSocket,
    meta?: { gpu?: string; name?: string }
): PodSocketConnection {
    const connection: PodSocketConnection = {
        key,
        podUrl,
        clientId,
        gpu: meta?.gpu,
        name: meta?.name,
        connectedAt: new Date().toISOString(),
        socket,
        subscribers: new Map(),
        pendingSubmissions: 0,
        buffered: new Map(),
        heartbeat: null,
        closed: false
    };

    // Preview attribution state — the most recent executing node/prompt,
    // exactly as ComfyUI's own prompt-event convention implies.
    let lastExecutingNode = '';
    let lastExecutingPromptId: string | null = null;

    /** Deliver one event to its prompt_id's subscriber(s), or buffer it. */
    const deliver = (event: StreamEvent) => {
        if (connection.closed) return;
        const pid = typeof event.data?.prompt_id === 'string' ? event.data.prompt_id : null;
        if (pid) {
            let delivered = false;
            for (const subscriber of connection.subscribers.values()) {
                if (subscriber.promptId !== pid) continue;
                delivered = true;
                try {
                    subscriber.onEvent(event);
                } catch {
                    // A crashing consumer must not break routing for others.
                }
            }
            if (!delivered) bufferEvent(connection.buffered, pid, event);
            return;
        }
        // Unattributed event (status broadcast, …) — every subscriber, the
        // same shape the old per-prompt socket consumers observed.
        for (const subscriber of connection.subscribers.values()) {
            try {
                subscriber.onEvent(event);
            } catch {
                // A crashing consumer must not break routing for others.
            }
        }
    };

    /** Remote close/error/failed ping → fail every prompt and deregister. */
    const terminate = (reason: string) => {
        if (connection.closed) return;
        connection.closed = true;
        if (connection.heartbeat !== null) {
            clearInterval(connection.heartbeat);
            connection.heartbeat = null;
        }
        if (podSockets.get(key) === connection) podSockets.delete(key);
        try {
            socket.close();
        } catch {
            // The terminal event below is what matters.
        }
        const terminal: StreamEvent = { type: 'prompt_error', data: { error: reason } };
        for (const subscriber of connection.subscribers.values()) {
            try {
                subscriber.onEvent(terminal);
            } catch {
                // Termination must reach every remaining subscriber.
            }
        }
        connection.subscribers.clear();
        connection.buffered.clear();
    };

    socket.addEventListener('close', () => terminate('ComfyUI websocket closed by the cloud server'));
    socket.addEventListener('error', () => terminate('ComfyUI websocket errored'));

    // Liveness: protocol pings only. A quiet pod is HEALTHY — unlike the
    // removed per-prompt sockets there is intentionally no response-silence
    // watchdog; the connection lives until the cloud server ends it.
    connection.heartbeat = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) {
            terminate('ComfyUI websocket stopped responding');
            return;
        }
        try {
            websocketPing(socket);
        } catch (error) {
            terminate(
                `ComfyUI websocket stopped responding: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }, POD_WS_HEARTBEAT_MS);
    // The pod registry must not keep a Node process alive by itself.
    const unref = (connection.heartbeat as unknown as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(connection.heartbeat);

    const handleMessage = async (data: unknown): Promise<void> => {
        if (connection.closed) return;

        if (typeof data === 'string') {
            let message: { type?: unknown; data?: unknown };
            try {
                message = JSON.parse(data) as { type?: unknown; data?: unknown };
            } catch {
                return; // malformed text frame — nothing to route
            }
            const type = typeof message?.type === 'string' ? message.type : 'raw';
            const eventData =
                message?.data && typeof message.data === 'object'
                    ? (message.data as Record<string, unknown>)
                    : {};

            // Track the executing node so following binary preview frames
            // can be attributed to it (and to its prompt for routing).
            if (type === 'executing') {
                const node = eventData.node;
                if (typeof node === 'string' && node) {
                    lastExecutingNode = node;
                    lastExecutingPromptId =
                        typeof eventData.prompt_id === 'string' ? eventData.prompt_id : null;
                }
            }
            deliver({ type, data: eventData });
            return;
        }

        // Binary frame — ComfyUI preview images (8-byte big-endian header
        // + raw image bytes), delivered as imagepreview.update.
        const bytes = await frameBytes(data);
        if (!bytes || bytes.length < 8) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const imageKind = view.getUint32(0, false);
        const mime =
            imageKind === PREVIEW_IMAGE_JPEG ? 'image/jpeg' : imageKind === PREVIEW_IMAGE_PNG ? 'image/png' : null;
        if (!mime) return;
        const payload = bytes.subarray(8);
        if (payload.length === 0) return;

        deliver({
            type: 'imagepreview.update',
            data: {
                node_id: lastExecutingNode,
                // Stamped prompt_id drives routing to JUST that subscriber;
                // absent (unknown prompt) it falls back to broadcast.
                ...(lastExecutingPromptId ? { prompt_id: lastExecutingPromptId } : {}),
                image: `data:${mime};base64,${Buffer.from(payload).toString('base64')}`
            }
        });
    };

    // Serialize message handling: events must be delivered in arrival order,
    // and binary preview decoding is async.
    let chain: Promise<void> = Promise.resolve();
    socket.addEventListener('message', (event) => {
        chain = chain.then(() => handleMessage((event as MessageEvent).data)).catch(() => {
            // A dropped frame must not kill the pod's shared socket.
        });
    });

    return connection;
}

/** Buffer one event for a not-yet-subscribed prompt_id (ack → subscribe race). */
function bufferEvent(buffered: Map<string, StreamEvent[]>, promptId: string, event: StreamEvent): void {
    const list = buffered.get(promptId) ?? [];
    list.push(event);
    if (list.length > MAX_BUFFERED_EVENTS_PER_PROMPT) list.shift();
    if (!buffered.has(promptId)) buffered.set(promptId, list);
}

/** Normalize one websocket binary frame to bytes (undici delivers Buffer/Blob/ArrayBuffer). */
async function frameBytes(data: unknown): Promise<Uint8Array | null> {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    return null;
}
