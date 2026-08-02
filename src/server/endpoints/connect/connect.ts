// ComfyUI direct connection endpoints.
//
// POST /v1/comfy/connect
//   Opens a long-lived websocket to a pod and returns a connectId.
// POST /v1/comfy/connect/:connect_id
//   Sends a native ComfyUI prompt to the connected pod.
// GET /v1/comfy/cloud/connect/:connect_id/request/:client_id
//   Returns the JSON event log persisted for one websocket client id.

import { randomUUID } from 'node:crypto';
import { WebSocket } from 'undici';
import { asHandlerMethod } from '@underload/service';
import {
    appendClientLogEvent,
    ensureClientLog,
    isSafeConnectPathSegment,
    readClientLog,
    type ConnectClientLogMetadata
} from './connect-store';

// The native ComfyUI websocket and prompt endpoints are both expected to be
// reachable quickly during connection setup. Prompt execution itself remains
// asynchronous inside ComfyUI, so this timeout only covers socket handshakes.
export const CONNECT_SOCKET_TIMEOUT_MS = 10_000;

// ComfyUI documents client ids as 32-character hexadecimal strings. Restricting
// supplied ids to that format also makes each persisted filename unambiguous.
const COMFY_CLIENT_ID = /^[0-9a-f]{32}$/i;

type WebSocketMessage = {
    type?: unknown;
    data?: unknown;
    client_id?: unknown;
    clientId?: unknown;
    sid?: unknown;
};

type ClientSubscription = {
    requestedClientId: string;
    clientId: string;
    socket: WebSocket;
};

type PodConnection = {
    connectId: string;
    podUrl: URL;
    root: string;
    baseClientId: string;
    clients: Map<string, ClientSubscription>;
};

// This process-local registry owns the live sockets. The persisted files remain
// available after a process restart, but an old connectId cannot send new work
// until the caller creates another live connection.
const connections = new Map<string, PodConnection>();

/** Generate the 32-character id required by ComfyUI's websocket protocol. */
export function newComfyClientId(): string {
    return randomUUID().replace(/-/g, '');
}

/** Generate a path-safe id returned to clients for the pod connection. */
export function newConnectId(): string {
    return randomUUID().replace(/-/g, '');
}

/** Validate and normalize the pod URL before any network operation. */
export function parsePodUrl(value: unknown): URL | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url;
    } catch {
        return null;
    }
}

/** Add a ComfyUI route below a pod base URL without losing its prefix path. */
function podRoute(podUrl: URL, route: string): URL {
    const result = new URL(podUrl.toString());
    const basePath = result.pathname.replace(/\/+$/, '');
    result.pathname = `${basePath}${route}` || route;
    return result;
}

/** Convert the HTTP pod URL into a native ComfyUI websocket URL. */
export function websocketUrl(podUrl: URL, clientId: string): string {
    const result = podRoute(podUrl, '/ws');
    result.protocol = result.protocol === 'https:' ? 'wss:' : 'ws:';
    result.searchParams.set('clientId', clientId);
    return result.toString();
}

/** Decode one websocket frame while preserving binary previews losslessly. */
async function websocketDataToMessage(data: unknown): Promise<unknown> {
    if (typeof data === 'string') {
        try {
            return JSON.parse(data);
        } catch {
            return { type: 'raw', data };
        }
    }

    if (data instanceof Blob) {
        const bytes = Buffer.from(await data.arrayBuffer());
        return { type: 'binary', data: bytes.toString('base64') };
    }
    if (data instanceof ArrayBuffer) {
        return { type: 'binary', data: Buffer.from(data).toString('base64') };
    }
    if (ArrayBuffer.isView(data)) {
        const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
        return { type: 'binary', data: bytes.toString('base64') };
    }
    return { type: 'raw', data: String(data) };
}

/** Extract a client identifier from ComfyUI's status/enqueue message shapes. */
export function extractWebSocketClientId(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;
    const value = message as WebSocketMessage;
    const data = value.data && typeof value.data === 'object' ? (value.data as WebSocketMessage) : undefined;
    const candidates = [value.client_id, value.clientId, data?.client_id, data?.clientId, data?.sid];
    const clientId = candidates.find((candidate): candidate is string => typeof candidate === 'string');
    return clientId && COMFY_CLIENT_ID.test(clientId) ? clientId : null;
}

/** Wait until the undici websocket handshake is complete or fails. */
function waitForSocketOpen(socket: WebSocket, timeoutMs: number = CONNECT_SOCKET_TIMEOUT_MS): Promise<void> {
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

        // A fake/test socket or a synchronously completed implementation may
        // reach OPEN between construction and listener registration.
        if (socket.readyState === WebSocket.OPEN) finish();
    });
}

/** Build the metadata shared by every event file belonging to this connection. */
function logMetadata(connection: PodConnection, clientId: string): ConnectClientLogMetadata {
    return {
        connectId: connection.connectId,
        clientId,
        podUrl: connection.podUrl.toString()
    };
}

/** Attach the permanent event reader to one ComfyUI websocket. */
function observeSocket(connection: PodConnection, subscription: ClientSubscription): void {
    subscription.socket.addEventListener('message', (event) => {
        void (async () => {
            // JSON frames are parsed as their original objects; binary preview
            // frames and malformed text become explicit lossless envelopes.
            const message = await websocketDataToMessage(event.data);

            // ComfyUI's first status message carries `data.sid`; use that value
            // as the authoritative id rather than trusting only the URL query.
            const discoveredClientId = extractWebSocketClientId(message);
            if (discoveredClientId) {
                subscription.clientId = discoveredClientId;
                connection.clients.set(discoveredClientId, subscription);
                await ensureClientLog(connection.root, logMetadata(connection, discoveredClientId));
            }

            // The requested id is a safe fallback for events that do not repeat
            // `sid` (progress, executing, binary previews, and similar frames).
            const clientId = subscription.clientId;
            await ensureClientLog(connection.root, logMetadata(connection, clientId));
            await appendClientLogEvent(connection.root, logMetadata(connection, clientId), message);
        })().catch(() => {
            // A dropped disk write must not terminate the websocket event loop.
        });
    });

    // A closed socket is left in the registry as a reconnectable subscription;
    // the next prompt call reopens it with the same client id before POST /prompt.
    subscription.socket.addEventListener('close', () => undefined);
}

/** Open and observe a websocket for one client id, reusing an active one. */
async function ensureClientSubscription(connection: PodConnection, clientId: string): Promise<ClientSubscription> {
    const existing = connection.clients.get(clientId);
    if (existing && existing.socket.readyState === WebSocket.OPEN) return existing;

    if (existing && existing.socket.readyState !== WebSocket.CLOSED) {
        try {
            existing.socket.close();
        } catch {
            // A failed close is harmless; the new socket below replaces it.
        }
    }

    const socket = new WebSocket(websocketUrl(connection.podUrl, clientId));
    const subscription: ClientSubscription = {
        requestedClientId: clientId,
        clientId,
        socket
    };
    connection.clients.set(clientId, subscription);
    observeSocket(connection, subscription);

    try {
        await waitForSocketOpen(socket);
    } catch (error) {
        connection.clients.delete(clientId);
        try {
            socket.close();
        } catch {
            // The original handshake error is the useful response to the caller.
        }
        throw error;
    }

    await ensureClientLog(connection.root, logMetadata(connection, subscription.clientId));
    return subscription;
}

/** Return the current project root used for persistent connection files. */
function projectRoot(variables: Record<string, any> | undefined): string {
    return typeof variables?.root === 'string' && variables.root ? variables.root : process.cwd();
}

/** Create a live pod connection after validating a native websocket handshake. */
export const connectPod = asHandlerMethod(async (_request, parameters, variables) => {
    const body = (parameters.body ?? {}) as { pod_url?: unknown };
    const podUrl = parsePodUrl(body.pod_url);
    if (!podUrl) {
        return { status: 400, response: { error: 'A valid pod_url is required' } };
    }

    const connection: PodConnection = {
        connectId: newConnectId(),
        podUrl,
        root: projectRoot(variables),
        baseClientId: newComfyClientId(),
        clients: new Map()
    };

    try {
        // Opening the websocket is the direct connectivity check. It is kept
        // open after this request so events are captured before any prompt call.
        await ensureClientSubscription(connection, connection.baseClientId);
        connections.set(connection.connectId, connection);
        return {
            status: 200,
            response: {
                connectId: connection.connectId,
                client_id: connection.baseClientId
            }
        };
    } catch (error) {
        closeConnectionSockets(connection);
        return {
            status: 502,
            response: {
                error: `Failed to connect to pod: ${error instanceof Error ? error.message : String(error)}`
            }
        };
    }
});

/** Send a prompt directly to native ComfyUI POST /prompt. */
export const sendConnectedPrompt = asHandlerMethod(async (request, parameters, _variables) => {
    const connectId = parameters.path.connect_id;
    if (!isSafeConnectPathSegment(connectId)) {
        return { status: 400, response: { error: 'connect_id is required' } };
    }

    const connection = connections.get(connectId);
    if (!connection) {
        return { status: 404, response: { error: `Connection '${connectId}' not found` } };
    }

    const body = (parameters.body ?? {}) as Record<string, unknown>;
    if (!body.prompt || typeof body.prompt !== 'object' || Array.isArray(body.prompt)) {
        return { status: 400, response: { error: 'prompt object is required' } };
    }

    const requestedClientId = body.client_id;
    if (requestedClientId !== undefined && (typeof requestedClientId !== 'string' || !COMFY_CLIENT_ID.test(requestedClientId))) {
        return { status: 400, response: { error: 'client_id must be a 32-character hexadecimal string' } };
    }
    const clientId = (requestedClientId as string | undefined) ?? connection.baseClientId;

    try {
        // The websocket is opened before POST /prompt so ComfyUI cannot emit an
        // execution event before this server starts reading it.
        await ensureClientSubscription(connection, clientId);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Accept: 'application/json'
        };
        const authorization = request.req.header('authorization');
        if (authorization) headers.Authorization = authorization;

        const payload = { ...body, client_id: clientId };
        const upstream = await fetch(podRoute(connection.podUrl, '/prompt').toString(), {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        const contentType = upstream.headers.get('content-type') ?? '';
        const upstreamBody = contentType.includes('json')
            ? await upstream.json().catch(() => ({ error: `Pod returned HTTP ${upstream.status}` }))
            : await upstream.text();

        // Preserve native ComfyUI prompt fields while returning the id needed
        // to read this prompt's websocket file through the request endpoint.
        const response =
            upstreamBody && typeof upstreamBody === 'object' && !Array.isArray(upstreamBody)
                ? { ...(upstreamBody as Record<string, unknown>), connectId, client_id: clientId }
                : { connectId, client_id: clientId, result: upstreamBody };
        return { status: upstream.status, response };
    } catch (error) {
        return {
            status: 502,
            response: {
                error: `Failed to send prompt: ${error instanceof Error ? error.message : String(error)}`
            }
        };
    }
});

/** Return one persisted client event log, including logs from old connections. */
export const getConnectedRequest = asHandlerMethod(async (_request, parameters, variables) => {
    const connectId = parameters.path.connect_id;
    const clientId = parameters.path.client_id;
    if (!isSafeConnectPathSegment(connectId)) {
        return { status: 400, response: { error: 'connect_id is required' } };
    }
    if (!isSafeConnectPathSegment(clientId)) {
        return { status: 400, response: { error: 'client_id is required' } };
    }
    if (!COMFY_CLIENT_ID.test(clientId)) {
        return { status: 400, response: { error: 'client_id must be a 32-character hexadecimal string' } };
    }

    const log = await readClientLog(projectRoot(variables), connectId, clientId);
    if (!log) {
        return { status: 404, response: { error: `Client request '${clientId}' not found` } };
    }
    return { status: 200, response: log };
});

/** Close all sockets owned by one connection without deleting its log files. */
export function closeConnection(connectId: string): void {
    const connection = connections.get(connectId);
    if (!connection) return;
    closeConnectionSockets(connection);
    connections.delete(connectId);
}

/** Reset all live sockets for deterministic tests and process shutdown hooks. */
export function closeAllConnections(): void {
    for (const connection of connections.values()) closeConnectionSockets(connection);
    connections.clear();
}

/** Close every subscription belonging to a connection. */
function closeConnectionSockets(connection: PodConnection): void {
    const closed = new Set<WebSocket>();
    for (const subscription of connection.clients.values()) {
        if (closed.has(subscription.socket)) continue;
        closed.add(subscription.socket);
        try {
            subscription.socket.close();
        } catch {
            // Socket cleanup is best-effort because the connection may already
            // have been terminated by the remote pod.
        }
    }
    connection.clients.clear();
}
