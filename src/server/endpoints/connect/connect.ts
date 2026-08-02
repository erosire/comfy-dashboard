// ComfyUI managed connection endpoints.
//
// POST /v1/comfy/connect
//   Picks a ComfyUI server from the configured server list (auto-start
//   endpoints cold-boot on contact), waits for ComfyUI to finish starting,
//   opens a native websocket and returns a connect_id (uuid).
// POST /v1/comfy/connect/:connect_id
//   Sends a native ComfyUI prompt to the connection's server; the response
//   carries ComfyUI's prompt_id.
// GET /v1/comfy/connect/:connect_id/:prompt_id
//   Returns the recorded websocket event list for one prompt_id — as a JSON
//   snapshot, or as a live SSE stream with ?stream=true.
//
// The server keeps the connection's websocket open in the background and
// records EVERY received message to disk: messages carrying data.prompt_id
// land in `<root>/connect/<connect_id>/<prompt_id>.json`; messages without
// one (status broadcasts, binary preview frames) are attributed to the
// prompt currently in flight, or to the connection's session log when no
// prompt is active yet.

import { randomUUID } from 'node:crypto';
import { WebSocket } from 'undici';
import { asHandlerMethod } from '@underload/service';
import { comfy } from '@runtime/secret/private';
import {
    appendPromptLogEvent,
    ensurePromptLog,
    isSafeConnectPathSegment,
    readPromptLog,
    type ConnectLogEvent,
    type ConnectPromptLog,
    type ConnectPromptLogMetadata
} from './connect-store';

// The native ComfyUI websocket handshake is expected to complete quickly once
// the server itself is up; prompt execution remains asynchronous inside
// ComfyUI, so this timeout only covers socket handshakes.
export const CONNECT_SOCKET_TIMEOUT_MS = 10_000;

// Auto-start ComfyUI endpoints (Modal snapshot playgrounds) cold-boot the
// server on first contact. The connect flow polls GET /system_stats until
// the server answers — only then is it considered started. `startup_timeout`
// on those deployments is 300 s, so the per-server readiness window defaults
// to the same budget.
export const CONNECT_READY_TIMEOUT_MS = 300_000;
export const CONNECT_READY_ATTEMPT_TIMEOUT_MS = 10_000;
export const CONNECT_READY_POLL_MS = 2_000;

// Poll interval for the live SSE tail of a prompt log (GET ...?stream=true).
export const CONNECT_STREAM_POLL_MS = 500;

// Catch-all log file for websocket messages received before any prompt is
// known (initial status broadcasts and similar frames).
export const SESSION_LOG_ID = 'session';

// ComfyUI documents client ids as 32-character hexadecimal strings.
const COMFY_CLIENT_ID = /^[0-9a-f]{32}$/i;

// Events that mark a prompt's stream as finished — after one of these the
// SSE stream ends (the persisted log remains readable afterwards).
const TERMINAL_EVENT_TYPES = new Set(['execution_success', 'execution_error', 'execution_interrupted']);

type WebSocketMessage = {
    type?: unknown;
    data?: unknown;
    prompt_id?: unknown;
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
    /** prompt_id of the most recently observed prompt — used to attribute websocket messages that carry no prompt_id (status frames, binary previews). */
    lastPromptId: string | null;
};

/** One entry of the ComfyUI server list /connect picks from. */
export type ConnectServerEntry = {
    name: string;
    url: string;
};

// This process-local registry owns the live sockets. The persisted prompt
// files remain available after a process restart, but an old connect_id
// cannot send new work until the caller creates another live connection.
const connections = new Map<string, PodConnection>();

// Round-robin offset into the server list so consecutive /connect calls
// spread over the configured servers instead of always hitting the first.
let nextServerIndex = 0;

/** Generate the 32-character id required by ComfyUI's websocket protocol. */
export function newComfyClientId(): string {
    return randomUUID().replace(/-/g, '');
}

/** Generate the connect_id (a uuid) returned to clients for the connection. */
export function newConnectId(): string {
    return randomUUID();
}

/** Validate and normalize a server URL before any network operation. */
export function parseServerUrl(value: unknown): URL | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
        return url;
    } catch {
        return null;
    }
}

/**
 * Resolve the ComfyUI server list /connect picks from. The default is the
 * auto-start list from the runtime secrets (`comfy`); `variables.comfyServers`
 * overrides it (either a `{ name: url }` map or a plain url array).
 */
export function resolveServerEntries(variables: Record<string, any> | undefined): ConnectServerEntry[] {
    const source: unknown = variables?.comfyServers ?? comfy;
    if (Array.isArray(source)) {
        return source
            .filter((url): url is string => typeof url === 'string' && Boolean(url.trim()))
            .map((url, index) => ({ name: `server-${index + 1}`, url }));
    }
    if (source && typeof source === 'object') {
        return Object.entries(source as Record<string, unknown>)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim()))
            .map(([name, url]) => ({ name, url }));
    }
    return [];
}

/** Add a ComfyUI route below a server base URL without losing its prefix path. */
function serverRoute(podUrl: URL, route: string): URL {
    const result = new URL(podUrl.toString());
    const basePath = result.pathname.replace(/\/+$/, '');
    result.pathname = `${basePath}${route}` || route;
    return result;
}

/** Convert the HTTP server URL into a native ComfyUI websocket URL. */
export function websocketUrl(podUrl: URL, clientId: string): string {
    const result = serverRoute(podUrl, '/ws');
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

/** Extract the prompt identifier carried by ComfyUI's execution messages. */
export function extractWebSocketPromptId(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;
    const value = message as WebSocketMessage;
    const data = value.data && typeof value.data === 'object' ? (value.data as WebSocketMessage) : undefined;
    const candidates = [data?.prompt_id, value.prompt_id];
    const promptId = candidates.find((candidate): candidate is string => typeof candidate === 'string');
    return promptId && promptId.trim() ? promptId : null;
}

/** Whether a recorded message ends a prompt's event stream. */
export function isTerminalPromptEvent(message: unknown): boolean {
    if (!message || typeof message !== 'object') return false;
    const type = (message as WebSocketMessage).type;
    return typeof type === 'string' && TERMINAL_EVENT_TYPES.has(type);
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

/**
 * Wait until the ComfyUI server behind an (auto-start) endpoint has finished
 * starting. Contacting the endpoint cold-boots the instance; ComfyUI signals
 * readiness via GET /system_stats answering HTTP 200.
 */
export async function waitForServerReady(
    podUrl: URL,
    timeoutMs: number = CONNECT_READY_TIMEOUT_MS,
    pollMs: number = CONNECT_READY_POLL_MS
): Promise<void> {
    const startedAt = Date.now();
    let lastError = 'no response';

    while (Date.now() - startedAt < timeoutMs) {
        try {
            const response = await fetch(serverRoute(podUrl, '/system_stats'), {
                method: 'GET',
                headers: { Accept: 'application/json' },
                // A hanging boot probe must not stall the whole poll loop.
                signal: AbortSignal.timeout(CONNECT_READY_ATTEMPT_TIMEOUT_MS)
            });
            if (response.ok) return;
            lastError = `HTTP ${response.status}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new Error(`ComfyUI did not start within ${Math.round(timeoutMs / 1000)}s (last: ${lastError})`);
}

/** Build the metadata shared by every prompt file belonging to this connection. */
function logMetadata(connection: PodConnection, promptId: string): ConnectPromptLogMetadata {
    return {
        connectId: connection.connectId,
        promptId,
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
            }

            // Record every websocket message for this connection. Execution
            // messages name their prompt_id; messages without one (status
            // broadcasts, binary preview frames) are attributed to the prompt
            // currently in flight, or to the connection-wide session log when
            // no prompt has been observed yet.
            const promptId = extractWebSocketPromptId(message);
            if (promptId) connection.lastPromptId = promptId;
            const targetPromptId = promptId ?? connection.lastPromptId ?? SESSION_LOG_ID;

            const metadata = logMetadata(connection, targetPromptId);
            await ensurePromptLog(connection.root, metadata);
            await appendPromptLogEvent(connection.root, metadata, message);
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

    return subscription;
}

/** Return the current project root used for persistent connection files. */
function projectRoot(variables: Record<string, any> | undefined): string {
    return typeof variables?.root === 'string' && variables.root ? variables.root : process.cwd();
}

/**
 * Establish a ComfyUI connection: pick a server from the configured list,
 * wait for it to finish starting, then open the persistent websocket. An
 * optional body `server` names a specific list entry; otherwise candidates
 * are tried in round-robin order until one starts up.
 */
export const connectServer = asHandlerMethod(async (_request, parameters, variables) => {
    const body = (parameters.body ?? {}) as { server?: unknown };
    const entries = resolveServerEntries(variables);
    if (entries.length === 0) {
        return { status: 500, response: { error: 'No ComfyUI servers are configured' } };
    }

    let candidates: ConnectServerEntry[];
    if (body.server !== undefined) {
        if (typeof body.server !== 'string' || !body.server.trim()) {
            return { status: 400, response: { error: 'server must be a non-empty string' } };
        }
        candidates = entries.filter((entry) => entry.name === body.server);
        if (candidates.length === 0) {
            return {
                status: 400,
                response: {
                    error: `Unknown ComfyUI server '${body.server}'`,
                    servers: entries.map((entry) => entry.name)
                }
            };
        }
    } else {
        // Round-robin start offset: consecutive connections spread over the
        // list, and every server gets one startup window before giving up.
        const offset = entries.length > 0 ? nextServerIndex % entries.length : 0;
        candidates = [...entries.slice(offset), ...entries.slice(0, offset)];
    }

    const readyTimeoutMs =
        typeof variables?.connectReadyTimeoutMs === 'number' && variables.connectReadyTimeoutMs > 0
            ? variables.connectReadyTimeoutMs
            : CONNECT_READY_TIMEOUT_MS;
    const readyPollMs =
        typeof variables?.connectReadyPollMs === 'number' && variables.connectReadyPollMs > 0
            ? variables.connectReadyPollMs
            : CONNECT_READY_POLL_MS;

    const failures: string[] = [];
    for (const candidate of candidates) {
        const podUrl = parseServerUrl(candidate.url);
        if (!podUrl) {
            failures.push(`${candidate.name}: invalid url '${candidate.url}'`);
            continue;
        }

        const connection: PodConnection = {
            connectId: newConnectId(),
            podUrl,
            root: projectRoot(variables),
            baseClientId: newComfyClientId(),
            clients: new Map(),
            lastPromptId: null
        };

        try {
            // Contacting an auto-start endpoint cold-boots its ComfyUI; poll
            // until the server answers before reporting the connection.
            await waitForServerReady(podUrl, readyTimeoutMs, readyPollMs);

            // The websocket is the direct connectivity check and is kept open
            // afterwards so events are captured from this moment on.
            await ensureClientSubscription(connection, connection.baseClientId);
            connections.set(connection.connectId, connection);
            nextServerIndex++;
            return {
                status: 200,
                response: {
                    connect_id: connection.connectId,
                    client_id: connection.baseClientId,
                    server: candidate.name,
                    pod_url: podUrl.toString()
                }
            };
        } catch (error) {
            closeConnectionSockets(connection);
            failures.push(`${candidate.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return {
        status: 502,
        response: { error: `No ComfyUI server could be started — ${failures.join('; ')}` }
    };
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
        const upstream = await fetch(serverRoute(connection.podUrl, '/prompt').toString(), {
            method: 'POST',
            headers,
            body: JSON.stringify(payload)
        });

        const contentType = upstream.headers.get('content-type') ?? '';
        const upstreamBody = contentType.includes('json')
            ? await upstream.json().catch(() => ({ error: `ComfyUI returned HTTP ${upstream.status}` }))
            : await upstream.text();

        // The prompt's websocket log is addressed by prompt_id — create it as
        // soon as ComfyUI assigns one so early events never arrive at a
        // missing file (the append path would recreate it anyway).
        if (upstreamBody && typeof upstreamBody === 'object' && !Array.isArray(upstreamBody)) {
            const promptId = (upstreamBody as Record<string, unknown>).prompt_id;
            if (typeof promptId === 'string' && isSafeConnectPathSegment(promptId)) {
                connection.lastPromptId = promptId;
                void ensurePromptLog(connection.root, logMetadata(connection, promptId)).catch(() => undefined);
            }
            return {
                status: upstream.status,
                response: { ...(upstreamBody as Record<string, unknown>), connect_id: connectId, client_id: clientId }
            };
        }
        return { status: upstream.status, response: { connect_id: connectId, client_id: clientId, result: upstreamBody } };
    } catch (error) {
        return {
            status: 502,
            response: {
                error: `Failed to send prompt: ${error instanceof Error ? error.message : String(error)}`
            }
        };
    }
});

/**
 * Replay the persisted prompt log, then keep yielding new events as the
 * websocket recorder appends them (the file is the single source of truth —
 * the generator re-reads it on a poll interval, relying on strictly-appended
 * `events`). The stream ends after the prompt's terminal event
 * (execution_success / execution_error / execution_interrupted).
 */
export async function* streamPromptLogEvents(
    root: string,
    connectId: string,
    promptId: string,
    initial?: ConnectPromptLog | null,
    pollMs: number = CONNECT_STREAM_POLL_MS
): AsyncGenerator<ConnectLogEvent> {
    let cursor = 0;
    let log = initial !== undefined ? initial : await readPromptLog(root, connectId, promptId);

    while (true) {
        const events = log?.events ?? [];
        // A recreated file resets the array — never skip events past its end.
        if (cursor > events.length) cursor = events.length;
        for (; cursor < events.length; cursor++) {
            const event = events[cursor];
            yield event;
            if (isTerminalPromptEvent(event.message)) return;
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        log = await readPromptLog(root, connectId, promptId);
    }
}

/**
 * Return one persisted prompt event log — including logs whose live
 * connection has already closed. With `?stream=true` (or `?stream=1`) the
 * response is a Server-Sent-Events stream instead: the recorded history
 * replayed first, then new events pushed live until the prompt's terminal
 * event.
 */
export const getConnectedPromptLog = asHandlerMethod(async (_request, parameters, variables) => {
    const connectId = parameters.path.connect_id;
    const promptId = parameters.path.prompt_id;
    if (!isSafeConnectPathSegment(connectId)) {
        return { status: 400, response: { error: 'connect_id is required' } };
    }
    if (!isSafeConnectPathSegment(promptId)) {
        return { status: 400, response: { error: 'prompt_id is required' } };
    }

    const root = projectRoot(variables);
    const streamWanted = parameters.query?.stream === 'true' || parameters.query?.stream === '1';

    const log = await readPromptLog(root, connectId, promptId);
    if (!log) {
        return { status: 404, response: { error: `Prompt '${promptId}' not found` } };
    }

    if (streamWanted) {
        return { status: 200, stream: streamPromptLogEvents(root, connectId, promptId, log) };
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
    nextServerIndex = 0;
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
            // have been terminated by the remote server.
        }
    }
    connection.clients.clear();
}
