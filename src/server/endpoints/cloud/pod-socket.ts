// Persistent cloud-pod websocket registry — ONE websocket per cloud pod.
//
// Pods are spawned via POST /v1/comfy/cloud (cloud.ts). That endpoint only
// answers AFTER connectPodSocket() resolves: the pod's native ComfyUI
// websocket is open and registered here. The connection then lives in
// SERVER MEMORY until the cloud server terminates it. On termination the
// pod drops out of the registry and every in-flight prompt subscriber
// receives a terminal `prompt_error` event, so its generation lands failed
// with the .log trail intact.
//
// ── Per-pod queue registry (the server's authoritative instance list) ──
// The server owns the truth about every cloud instance it created AND what
// each instance has queued: GET /v1/comfy/cloud reports each pod's `queue`
// (prompt_id, ComfyUI queue number, queued/running status, workflow +
// generation ids lifted from extra_data, timestamps) so clients never track
// pod state themselves — they only mirror the API answer.
//   - Entry CREATED at subscribePodPrompt (metadata stashed by
//     submitPodPrompt from the POST /prompt ack + extra_data);
//   - status flipped queued → running when the socket delivers
//     execution_start for the prompt_id;
//   - entry REMOVED when the socket delivers a terminal for the prompt_id
//     (execution_success / execution_interrupted / execution_error /
//     prompt_error) — queue lifetime follows the POD's execution, not the
//     consumer's: a canceled direct stream stays queued until ComfyUI
//     finishes it.
//
// ── Idle termination ───────────────────────────────────────────────────
// A pod whose queue drains to EMPTY (nothing queued, no pending submission)
// gets the idle countdown: no queue left + podIdleTimeoutMs (default 60 s,
// COMFY_DASHBOARD_POD_IDLE_TIMEOUT_MS) → the server terminates the
// connection. Every new submission cancels the countdown; the countdown
// starts at connect (a freshly spawned pod that never receives work is
// released too). Independent of the unreachable-pod termination below.
//
// ── Transport death ────────────────────────────────────────────────────
// Cloud pods are DESIGNED to terminate when idle and can never restart
// without the create-pod endpoint — so a dropped socket is not a transient
// network event: the pod is gone forever (undici surfaces a close-frame-
// less TCP drop as code 1006; observed on *.modal.host after the pod's
// server had already shut down). There is deliberately NO reconnection:
// attempts would only ever fail against the destroyed pod, delay the
// failure signal, and spam the log. Death is terminal — the generation
// fails with prompt_error and the only way back is a fresh pod via
// POST /v1/comfy/cloud.
//
// ── Reliable submission ────────────────────────────────────────────────
// The HTTP leg to the pod is far less reliable than the websocket: cloud
// tunnels intermittently drop POST /prompt (never arriving, or arriving and
// losing its ack). submitPodPromptReliably wraps the submission in a
// bounded retry: while the pod's websocket is ALIVE, a submission the pod
// did not confirm is re-attempted — every retry preceded by a
// queue/history probe (recoverPodPromptId) so a prompt that WAS dispatched
// is recovered by its prompt_id instead of being double-queued. The loop
// ends on acceptance, a definitive 4xx rejection, pod death, or budget
// expiry; the caller fails the generation explicitly in the last two
// cases, so nothing ever ghosts.
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
// ── Non-blocking pipeline ──────────────────────────────────────────────
// The event loop must never be parked by frame processing: protocol pings
// (heartbeat) and undici's receiver-side PONG answers run on the same loop,
// and a stalled loop turns into TCP backpressure that trips intermediary
// proxies. Therefore:
//   - message DELIVERY order is arrival order (a single per-socket promise
//     chain), so subscriber state machines (terminal handling) see exactly
//     the old serialized semantics;
//   - but expensive work STARTS at arrival, outside the chain: binary
//     preview base64 is computed eagerly — on a worker-thread pool for
//     large frames (pod-base64-pool.ts) — while preceding frames process;
//   - preview attribution (last executing node/prompt) is SNAPSHOT AT
//     ARRIVAL, because the async encode completes after later `executing`
//     frames may have moved the state on.
//
// Binary preview frames follow ComfyUI's send_image wire format: an 8-byte
// big-endian header — uint32 image kind (1 = JPEG, 2 = PNG), uint32 zero
// padding — followed by the raw image bytes.
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

import { scriptPause } from '@presource/core';
import { ping as websocketPing, WebSocket } from 'undici';
import {
    newDirectClientId,
    serverRoute,
    waitForSocketOpen,
    websocketUrl
} from './direct-comfy';
import { encodePodPayload } from './pod-base64-pool';
import type { StreamEvent } from '../workflows/generation-store';

/**
 * How long the persistent-socket handshake may take before pod creation is
 * declared failed. Freshly spawned pods can still be booting ComfyUI when
 * the spawner's 302 lands, so this is intentionally more patient than the
 * old 5 s throwaway probe (which returned immediately with an error field).
 */
export const POD_WS_OPEN_TIMEOUT_MS = 60_000;

/**
 * Retry cadence while waiting for a freshly spawned pod's websocket to come
 * up. A Modal/Beam pod that has just answered the spawner's 302 is often
 * still booting ComfyUI: the tunnel URL exists but nothing is listening on
 * the other side yet, so the first `new WebSocket(...)` fails immediately
 * with a transport error ("Unable to connect"). Instead of declaring the pod
 * dead on that first refusal, `connectPodSocket` retries the handshake on
 * this cadence until POD_WS_OPEN_TIMEOUT_MS elapses in total — the "wait 60
 * seconds for the pod to become reachable" behaviour.
 */
export const POD_WS_CONNECT_RETRY_MS = 2_000;

// Runtime-overridable copies of the two constants above (tests / operator
// tuning) — same pattern as podIdleTimeoutMs below. Defaults keep the
// documented 60 s budget with 2 s between attempts.
let podConnectTimeoutMs = POD_WS_OPEN_TIMEOUT_MS;
let podConnectRetryMs = POD_WS_CONNECT_RETRY_MS;

/** Override the total connect budget (tests / operator tuning). Returns the previous value. */
export function setPodConnectTimeoutMs(ms: number): number {
    const previous = podConnectTimeoutMs;
    podConnectTimeoutMs = ms;
    return previous;
}

/** Override the retry cadence (tests / operator tuning). Returns the previous value. */
export function setPodConnectRetryMs(ms: number): number {
    const previous = podConnectRetryMs;
    podConnectRetryMs = ms;
    return previous;
}

/**
 * How long recoverPodPromptId keeps probing a pod for a prompt whose HTTP
 * ack was lost. When POST /prompt fails AFTER dispatch (transport reset,
 * tunnel hiccup, undici "fetch failed"), the pod may already be executing
 * the prompt — abandoning it there would orphan the run (a ghost job the
 * server never monitors). The probe window gives a slow pod time to surface
 * the queued/finished prompt before the caller gives up and fails the
 * generation explicitly.
 */
export const POD_PROMPT_RECOVERY_WINDOW_MS = 10_000;

/**
 * Cadence between recovery probes. The FIRST probe runs immediately (a
 * reset-after-dispatch prompt is usually already queued); later probes only
 * matter when the request was still in flight when the ack was lost.
 */
export const POD_PROMPT_RECOVERY_PROBE_MS = 1_000;

/**
 * Per-probe HTTP budget. A hung tunnel must not stretch a single probe past
 * a few seconds — the whole window bounds the caller's wait.
 */
export const POD_PROMPT_RECOVERY_PROBE_TIMEOUT_MS = 3_000;

// Runtime-overridable copies of the three recovery knobs (tests / operator
// tuning) — same pattern as the connect/idle overrides above.
let podRecoveryWindowMs = POD_PROMPT_RECOVERY_WINDOW_MS;
let podRecoveryProbeMs = POD_PROMPT_RECOVERY_PROBE_MS;
let podRecoveryProbeTimeoutMs = POD_PROMPT_RECOVERY_PROBE_TIMEOUT_MS;

/** Override the ack-loss recovery window. Returns the previous value. */
export function setPodRecoveryWindowMs(ms: number): number {
    const previous = podRecoveryWindowMs;
    podRecoveryWindowMs = ms;
    return previous;
}

/** Override the recovery probe cadence. Returns the previous value. */
export function setPodRecoveryProbeMs(ms: number): number {
    const previous = podRecoveryProbeMs;
    podRecoveryProbeMs = ms;
    return previous;
}

/** Override the per-probe HTTP budget. Returns the previous value. */
export function setPodRecoveryProbeTimeoutMs(ms: number): number {
    const previous = podRecoveryProbeTimeoutMs;
    podRecoveryProbeTimeoutMs = ms;
    return previous;
}

/**
 * How long submitPodPromptReliably keeps re-attempting a prompt submission
 * while the pod stays reachable. The user-facing contract: as long as the
 * pod's websocket is alive, a prompt that the pod did not accept (tunnel
 * blip, unreachable HTTP endpoint, lost ack with nothing on the pod) is
 * re-submitted until the pod's queue/history confirms it — or this budget
 * expires and the generation is failed explicitly. The window bounds the
 * caller's HTTP wait (the dashboard request stays open for all of it), so
 * 30 s trades a handful of retry cycles against how long a dead pod makes
 * the UI wait for its 502.
 */
export const POD_PROMPT_SUBMIT_RETRY_WINDOW_MS = 30_000;

/**
 * Pause between submission retry cycles. The cycle is submit → probe
 * (queue/history) → pause; the pause keeps a fully-down tunnel from being
 * hammered and gives transient network partitions time to heal.
 */
export const POD_PROMPT_SUBMIT_RETRY_PAUSE_MS = 2_000;

// Runtime-overridable copies (tests / operator tuning) — same pattern as
// the recovery knobs above.
let podPromptSubmitRetryWindowMs = POD_PROMPT_SUBMIT_RETRY_WINDOW_MS;
let podPromptSubmitRetryPauseMs = POD_PROMPT_SUBMIT_RETRY_PAUSE_MS;

/** Override the submission retry budget. Returns the previous value. */
export function setPodPromptSubmitRetryWindowMs(ms: number): number {
    const previous = podPromptSubmitRetryWindowMs;
    podPromptSubmitRetryWindowMs = ms;
    return previous;
}

/** Override the pause between submission retries. Returns the previous value. */
export function setPodPromptSubmitRetryPauseMs(ms: number): number {
    const previous = podPromptSubmitRetryPauseMs;
    podPromptSubmitRetryPauseMs = ms;
    return previous;
}

/**
 * Protocol-level ping cadence for the persistent socket. A failed write or
 * a non-OPEN readyState terminates the connection (and every prompt riding
 * it). There is deliberately NO response-silence watchdog here — an idle
 * pod is quiet by nature, and the connection must live until the cloud
 * server ends it.
 */
export const POD_WS_HEARTBEAT_MS = 10_000;

/**
 * Default idle grace period: when a pod's queue is empty (no queued prompt,
 * no pending submission) the server terminates the connection once the
 * queue has stayed empty for this long. Overridable at process level via
 * COMFY_DASHBOARD_POD_IDLE_TIMEOUT_MS, and per-process at runtime through
 * setPodIdleTimeoutMs (tests). Cloud pods bill while they exist — an idle
 * one is pure cost, and pods are designed to die and never come back, so
 * termination is the intended end of an idle pod.
 */
export const POD_IDLE_TIMEOUT_DEFAULT_MS = 60_000;

// Resolved once at module load: env wins when it parses to a positive number.
const envIdleTimeoutMs = Number(
    typeof process !== 'undefined' ? process.env?.COMFY_DASHBOARD_POD_IDLE_TIMEOUT_MS : undefined
);
let podIdleTimeoutMs =
    Number.isFinite(envIdleTimeoutMs) && envIdleTimeoutMs > 0 ? envIdleTimeoutMs : POD_IDLE_TIMEOUT_DEFAULT_MS;

/** The active idle timeout — a pod with an empty queue is terminated after this. */
export function getPodIdleTimeoutMs(): number {
    return podIdleTimeoutMs;
}

/**
 * Override the idle timeout (tests / operator tuning). Returns the previous
 * value so callers can restore it. A non-positive value DISABLES idle
 * termination entirely.
 */
export function setPodIdleTimeoutMs(ms: number): number {
    const previous = podIdleTimeoutMs;
    podIdleTimeoutMs = ms;
    return previous;
}

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

/**
 * Server-side record of one prompt queued on a pod — the unit of the
 * per-pod `queue` list reported by GET /v1/comfy/cloud. Lifecycle:
 * created at subscribe (status 'queued'), flipped to 'running' when the
 * socket delivers execution_start, removed when the socket delivers a
 * terminal event (execution_success / execution_interrupted /
 * execution_error / prompt_error) for its prompt_id.
 */
export type PodQueueEntry = {
    /** ComfyUI prompt_id — the routing AND queue key. */
    prompt_id: string;
    /** ComfyUI queue position from the POST /prompt ack, when numeric. */
    number: number | null;
    /** queued = accepted, awaiting execution; running = execution_start seen. */
    status: 'queued' | 'running';
    /** Dashboard ids lifted from extra_data (server-side processing mode). */
    workflow_id?: string;
    generation_id?: string;
    /** ISO timestamp when the server registered the prompt on this pod. */
    queuedAt: string;
    /** ISO timestamp of the execution_start flip (null while queued). */
    startedAt: string | null;
};

/**
 * Ack + extra_data metadata stashed between submitPodPrompt and its
 * subscribePodPrompt call — becomes the queue entry at subscribe time.
 */
type PodSubmissionMeta = {
    number: number | null;
    workflowId?: string;
    generationId?: string;
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
     * the single-socket design work. Reconnects keep the SAME id so
     * in-flight prompts resume routing to the fresh socket.
     */
    clientId: string;
    /** Spawn-time metadata echoed by GET /v1/comfy/cloud (best-effort). */
    gpu?: string;
    name?: string;
    /** ISO timestamp of the connection — diagnostics for the GET list. */
    connectedAt: string;
    /** The pod's one socket — never replaced (pods never recover). */
    socket: WebSocket;
    /** Live prompt consumers keyed by subscriber id. */
    subscribers: Map<string, PodPromptSubscriber>;
    /**
     * Submissions between POST /prompt and their subscribePodPrompt call.
     * Counted in the GET list's `prompts` so the brief gap stays visible.
     */
    pendingSubmissions: number;
    /**
     * The pod's queued prompts keyed by prompt_id — the server's
     * authoritative instance queue list (reported verbatim by GET
     * /v1/comfy/cloud). Entries track the POD's execution (queued →
     * running → terminal), NOT consumer subscription churn.
     */
    queue: Map<string, PodQueueEntry>;
    /**
     * Ack/extra_data metadata for submissions not yet subscribed — lifted
     * into the queue entry at subscribe time. Keyed by prompt_id.
     */
    submissionMeta: Map<string, PodSubmissionMeta>;
    /**
     * Events received for prompt_ids with no subscriber yet, keyed by
     * prompt_id. Flushed on subscribe; cleared on terminate.
     */
    buffered: Map<string, StreamEvent[]>;
    /** Liveness interval handle — needed by closeAllPodSockets teardown. */
    heartbeat: ReturnType<typeof setInterval> | null;
    /**
     * Idle-termination countdown — live ONLY while the pod has no queue
     * and no pending submission (updateIdleTimer is the single writer).
     */
    idleTimer: ReturnType<typeof setTimeout> | null;
    /** Set once the socket is dead — the pod is terminal. */
    closed: boolean;
};

/** GET /v1/comfy/cloud entry — one active pod with its queue. */
export type PodSocketInfo = {
    pod_url: string;
    gpu?: string;
    name?: string;
    client_id: string;
    /** The pod's server-managed websocket is currently open. */
    active: boolean;
    /** Prompts currently being processed by this pod (queue + submissions in flight). */
    prompts: number;
    /** The pod's queue — the server's authoritative record, insertion-ordered. */
    queue: PodQueueEntry[];
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
 * replaced. The handshake is RETRIED until podConnectTimeoutMs (default
 * POD_WS_OPEN_TIMEOUT_MS = 60 s) is spent — a freshly spawned pod usually
 * needs a few seconds for ComfyUI to boot before its tunnel accepts
 * connections, and a first-attempt refusal is not a dead pod. Throws only
 * when the whole budget is exhausted — the caller (create endpoint) then
 * refuses to return the pod.
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
    // A freshly spawned pod answers the spawner's 302 while ComfyUI inside it
    // is still booting, so the first handshake attempt is often refused
    // ("Unable to connect"). Keep retrying on the podConnectRetryMs cadence
    // until the overall podConnectTimeoutMs budget is spent — the pod gets a
    // full 60 s (default) to become reachable before create fails.
    const deadline = Date.now() + podConnectTimeoutMs;
    let socket: WebSocket | null = null;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
        socket = new WebSocket(websocketUrl(podUrl, clientId));
        try {
            await waitForSocketOpen(socket, Math.min(podConnectRetryMs, deadline - Date.now()));
            break;
        } catch (error) {
            // This attempt failed — close the socket, remember the error, and
            // retry while budget remains. waitForSocketOpen already detached
            // its listeners; close() here is best-effort cleanup.
            lastError = error;
            try {
                socket.close();
            } catch {
                // The next attempt is what matters.
            }
            socket = null;
            if (Date.now() < deadline) {
                await scriptPause(podConnectRetryMs);
            }
        }
    }
    if (!socket) {
        // Budget exhausted — the pod never became reachable. Surface the most
        // recent handshake error (usually "Unable to connect to ComfyUI
        // websocket") to the create endpoint's 502 path.
        throw lastError ?? new Error('Timed out connecting to ComfyUI websocket');
    }

    const connection = buildConnection(key, new URL(String(podUrl)), clientId, socket, meta);
    podSockets.set(key, connection);
    // A fresh pod has an empty queue — its idle countdown starts now: a
    // spawned pod that never receives work is released by the timeout.
    updateIdleTimer(connection);
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

/** GET /v1/comfy/cloud payload — every registered pod with its queue. */
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
            prompts: connection.queue.size + connection.pendingSubmissions,
            queue: [...connection.queue.values()],
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
        if (connection.idleTimer !== null) clearTimeout(connection.idleTimer);
        try {
            connection.socket.close();
        } catch {
            // Best-effort teardown.
        }
        connection.subscribers.clear();
        connection.queue.clear();
        connection.submissionMeta.clear();
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
    // A live submission cancels the idle countdown for its whole duration.
    updateIdleTimer(connection);
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
        updateIdleTimer(connection);
        throw error;
    }

    if (!response.ok) {
        connection.pendingSubmissions -= 1;
        updateIdleTimer(connection);
        return { response, ack: null };
    }

    let ack: PodPromptAck;
    try {
        ack = (await response.json()) as PodPromptAck;
    } catch {
        connection.pendingSubmissions -= 1;
        updateIdleTimer(connection);
        throw new Error(`ComfyUI POST /prompt returned HTTP ${response.status} with a non-JSON body`);
    }
    // Stash the ack + dashboard ids (extra_data) keyed by prompt_id —
    // subscribePodPrompt lifts this into the pod's queue entry.
    const promptId = typeof ack.prompt_id === 'string' && ack.prompt_id ? ack.prompt_id : null;
    if (promptId) {
        const extra = options.promptPayload.extra_data as Record<string, unknown> | undefined;
        const meta: PodSubmissionMeta = {
            number: typeof ack.number === 'number' ? ack.number : null
        };
        if (extra && typeof extra === 'object') {
            if (typeof extra.workflow_id === 'string') meta.workflowId = extra.workflow_id;
            if (typeof extra.generation_id === 'string') meta.generationId = extra.generation_id;
        }
        connection.submissionMeta.set(promptId, meta);
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
    // A terminated pod can never deliver another event (pods are designed to
    // die and never reconnect — see terminate/handleSocketDeath). Registering
    // a subscriber here would silently swallow its prompt: the run rides a
    // dead socket with no terminal ever firing — the GHOST-JOB failure mode
    // (a generation stuck 'pending' forever). Deliver the registry's terminal
    // prompt_error instead so consumers (cloud-prompt.ts trackGenerationOnPod)
    // finalize the generation as failed immediately. The queue entry is NOT
    // created: terminate() already cleared the registry state of this pod.
    if (connection.closed) {
        connection.pendingSubmissions = Math.max(0, connection.pendingSubmissions - 1);
        queueMicrotask(() => {
            try {
                subscriber.onEvent({
                    type: 'prompt_error',
                    data: {
                        error:
                            `ComfyUI websocket for ${connection.key} is closed — ` +
                            'the pod can no longer deliver this prompt\'s events'
                    }
                });
            } catch {
                // A crashing consumer must not break the caller.
            }
        });
        return () => undefined;
    }

    const id = newDirectClientId();
    connection.subscribers.set(id, { id, ...subscriber });
    connection.pendingSubmissions = Math.max(0, connection.pendingSubmissions - 1);

    // Lift the submission metadata into the pod's queue — the server's
    // authoritative record of what this instance has queued. The entry
    // lives until the socket delivers a terminal event for the prompt_id
    // (deliverEvent), independent of consumer churn below.
    if (subscriber.promptId) {
        const meta = connection.submissionMeta.get(subscriber.promptId);
        connection.submissionMeta.delete(subscriber.promptId);
        connection.queue.set(subscriber.promptId, {
            prompt_id: subscriber.promptId,
            number: meta?.number ?? null,
            status: 'queued',
            workflow_id: meta?.workflowId,
            generation_id: meta?.generationId,
            queuedAt: new Date().toISOString(),
            startedAt: null
        });
    }
    updateIdleTimer(connection);

    const early = connection.buffered.get(subscriber.promptId);
    if (early) {
        connection.buffered.delete(subscriber.promptId);
        // Deferred so a terminal event inside the flush cannot fire before
        // the caller received its unsubscribe handle.
        queueMicrotask(() => {
            early.forEach((event) => subscriber.onEvent(event));
            // The queue entry above was created AFTER deliverEvent's terminal
            // bookkeeping ran (the terminal arrived while the prompt was still
            // an unbuffered orphan — the ack→subscribe race on a fast run). If
            // the flush carried that terminal, drain the entry HERE — without
            // this the finished run would sit in the pod's queue forever and
            // pin the idle countdown open.
            if (early.some((event) => isTerminalEvent(event.type))) {
                connection.queue.delete(subscriber.promptId);
                updateIdleTimer(connection);
            }
        });
    }

    let unsubscribed = false;
    return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        connection.subscribers.delete(id);
        // The QUEUE entry is NOT removed here: it tracks the pod's
        // execution and is dropped by the terminal event (deliverEvent) —
        // a canceled consumer leaves the prompt queued on the pod.
    };
}

/**
 * Balance submitPodPrompt's pending count when the caller finalizes the run
 * WITHOUT subscribing (prompt rejected at validation time via node_errors,
 * or the socket died before subscription) — keeps the GET list's `prompts`
 * count honest, and discards the stashed metadata so it never becomes a
 * queue entry.
 */
export function releasePodSubmission(connection: PodSocketConnection, promptId?: string): void {
    connection.pendingSubmissions = Math.max(0, connection.pendingSubmissions - 1);
    if (promptId) connection.submissionMeta.delete(promptId);
    updateIdleTimer(connection);
}

/** The extra_data ids a recovered prompt must match (see recoverPodPromptId). */
export type PodPromptRecoveryMatch = {
    workflowId?: string;
    generationId?: string;
};

/**
 * Find a prompt on the pod after its POST /prompt ack was lost.
 *
 * When the submission's HTTP transport fails after dispatch (proxy reset,
 * tunnel hiccup, undici "fetch failed") or the ack body is unreadable, the
 * pod may already be executing the prompt — but the server never learned its
 * prompt_id, so it cannot subscribe by id. The pod's own state saves the day:
 *   - GET /queue  lists queued + running prompts as tuples
 *     [number, prompt_id, prompt, extra_data, outputs_to_execute];
 *   - GET /history lists finished prompts with the same tuple shape.
 * extra_data echoes what the submission sent (the dashboard always includes
 * workflow_id + generation_id), so matching extra_data recovers the
 * prompt_id. The shared socket's event buffer (bufferEvent) has been
 * accumulating that prompt's events all along, so subscribing to the
 * recovered id replays everything — including a terminal for a run that
 * already finished.
 *
 * Probes /queue first (running/queued), then /history (finished), retrying
 * until the window expires — an ack lost while the request was still in
 * flight needs a few attempts before the prompt surfaces. All transport
 * failures are swallowed (the next probe retries); returns null when the
 * window expires without a match, i.e. the prompt never started.
 *
 * Pending-count accounting mirrors submitPodPrompt: ONE count is held for
 * the WHOLE window (with the queue empty and the failed submission's count
 * already released, the idle countdown would otherwise terminate the pod
 * mid-probe and kill the very run being recovered). On success the count
 * stays held — subscribePodPrompt consumes it when the caller resumes
 * tracking, exactly like a normal ack → subscribe transfer. On failure
 * (no match, or the pod died mid-window) the count is released again.
 *
 * On success the matched prompt's metadata (queue number + the dashboard
 * ids from the match) is stashed in submissionMeta, so the queue entry
 * subscribePodPrompt creates carries the same workflow_id/generation_id a
 * normal ack would — GET /v1/comfy/cloud reports them and the dashboard's
 * settle-watch (which reads generation_id off queue entries) works for
 * recovered jobs too.
 */
export async function recoverPodPromptId(
    connection: PodSocketConnection,
    match: PodPromptRecoveryMatch,
    options?: { authorization?: string }
): Promise<string | null> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options?.authorization) headers['Authorization'] = options.authorization;

    // Hold the pod open for the whole probe window (see doc above).
    connection.pendingSubmissions += 1;
    updateIdleTimer(connection);

    const deadline = Date.now() + podRecoveryWindowMs;
    let found: { promptId: string; number: number | null } | null = null;
    try {
        while (!connection.closed && Date.now() < deadline) {
            found = await probePodForPrompt(connection, match, headers);
            if (found) break;
            if (connection.closed || Date.now() >= deadline) break;
            await scriptPause(Math.min(podRecoveryProbeMs, deadline - Date.now()));
        }
    } finally {
        if (found) {
            // Stash the ids + queue number so the queue entry created at
            // subscribe time matches what a normal ack would have produced.
            const meta: PodSubmissionMeta = { number: found.number };
            if (match.workflowId !== undefined) meta.workflowId = match.workflowId;
            if (match.generationId !== undefined) meta.generationId = match.generationId;
            connection.submissionMeta.set(found.promptId, meta);
        } else {
            // No match — the prompt never started (or the pod died mid-
            // window): release the hold so the idle countdown can resume.
            connection.pendingSubmissions = Math.max(0, connection.pendingSubmissions - 1);
            updateIdleTimer(connection);
        }
    }
    return found?.promptId ?? null;
}

/**
 * One recovery sweep: /queue (queued + running) then /history (finished).
 * Never throws — a failed probe is simply a missed sample; the retry loop
 * in recoverPodPromptId keeps the window open. Returns the matched prompt's
 * id plus its ComfyUI queue number (when the tuple carries one).
 */
async function probePodForPrompt(
    connection: PodSocketConnection,
    match: PodPromptRecoveryMatch,
    headers: Record<string, string>
): Promise<{ promptId: string; number: number | null } | null> {
    // Queued / currently executing prompts.
    try {
        const response = await fetch(serverRoute(connection.podUrl, '/queue').toString(), {
            headers,
            signal: AbortSignal.timeout(podRecoveryProbeTimeoutMs)
        });
        if (response.ok) {
            const data = (await response.json()) as Record<string, unknown>;
            for (const key of ['queue_running', 'queue_pending']) {
                const list = data?.[key];
                if (!Array.isArray(list)) continue;
                for (const entry of list) {
                    if (!extraDataMatches(tupleExtraData(entry), match)) continue;
                    const promptId = tuplePromptId(entry);
                    if (promptId) return { promptId, number: tupleQueueNumber(entry) };
                }
            }
        }
    } catch {
        // Probe failure — the retry loop keeps the window open.
    }

    // Already-finished prompts — a fast run can beat the probe entirely.
    // max_items keeps the response bounded on pods with long histories.
    try {
        const historyUrl = serverRoute(connection.podUrl, '/history');
        historyUrl.searchParams.set('max_items', '64');
        const response = await fetch(historyUrl.toString(), {
            headers,
            signal: AbortSignal.timeout(podRecoveryProbeTimeoutMs)
        });
        if (response.ok) {
            const data = (await response.json()) as unknown;
            // Shape: { [prompt_id]: { prompt: [number, prompt_id, prompt, extra_data, outputs], … } }
            if (data && typeof data === 'object' && !Array.isArray(data)) {
                for (const value of Object.values(data as Record<string, unknown>)) {
                    const tuple = value && typeof value === 'object' ? (value as Record<string, unknown>).prompt : null;
                    if (!extraDataMatches(tupleExtraData(tuple), match)) continue;
                    const promptId = tuplePromptId(tuple);
                    if (promptId) return { promptId, number: tupleQueueNumber(tuple) };
                }
            }
        }
    } catch {
        // Probe failure — the retry loop keeps the window open.
    }

    return null;
}

/**
 * Extract a queue/history entry's queue number (index 0 of the prompt
 * tuple). Null for non-numeric values.
 */
function tupleQueueNumber(entry: unknown): number | null {
    return Array.isArray(entry) && typeof entry[0] === 'number' ? entry[0] : null;
}

/**
 * Extract a queue/history entry's extra_data (index 3 of the prompt tuple).
 * Returns null for anything that is not a plain object — ComfyUI sends {}
 * when no extra_data was supplied.
 */
function tupleExtraData(entry: unknown): Record<string, unknown> | null {
    if (!Array.isArray(entry) || entry.length < 4) return null;
    const extra = entry[3];
    return extra && typeof extra === 'object' && !Array.isArray(extra)
        ? (extra as Record<string, unknown>)
        : null;
}

/** Extract a queue/history entry's prompt_id (index 1 of the prompt tuple). */
function tuplePromptId(entry: unknown): string | null {
    return Array.isArray(entry) && typeof entry[1] === 'string' && entry[1] ? entry[1] : null;
}

/**
 * Match a recovered entry's extra_data against the dashboard ids. Every
 * provided key must match exactly; at least one key must be provided so an
 * empty match spec can never return an arbitrary prompt.
 */
function extraDataMatches(
    extra: Record<string, unknown> | null,
    match: PodPromptRecoveryMatch
): boolean {
    if (!extra) return false;
    if (match.generationId !== undefined && extra.generation_id !== match.generationId) return false;
    if (match.workflowId !== undefined && extra.workflow_id !== match.workflowId) return false;
    return match.generationId !== undefined || match.workflowId !== undefined;
}

// ── Reliable submission (bounded retry while the pod is reachable) ──────

/** How submitPodPromptReliably ended — drives the endpoint's response. */
export type PodPromptSubmitOutcome =
    /** The pod accepted the prompt (fresh ack, or recovered by prompt_id). */
    | { kind: 'accepted'; ack: PodPromptAck; /** true when the ack was lost but the prompt was found on the pod. */ recovered: boolean }
    /** The pod definitively REJECTED the prompt (HTTP 4xx) — retrying can never fix a validation error. */
    | { kind: 'rejected'; response: Response }
    /**
     * The retry budget expired (or the pod became unreachable) without the
     * prompt ever being accepted — the caller must fail the generation
     * explicitly so it can never sit 'pending' as a ghost.
     */
    | { kind: 'gave-up'; message: string; attempts: number };

/**
 * Submit a prompt to a pod with a bounded retry loop: AS LONG AS the pod's
 * persistent websocket is alive, a submission that the pod did not confirm
 * is re-attempted until the pod's queue/history shows the prompt.
 *
 * Why this exists: cloud tunnels (Modal/Beam) intermittently drop the HTTP
 * leg — the POST /prompt may never arrive, or arrive and lose its ack. A
 * single attempt + single recovery probe gave up too early: the user saw
 * "the prompt is not in the queue" errors while the pod sat idle and
 * reachable.
 *
 * The cycle, per iteration:
 *   1. POST /prompt (bound to the shared socket's client_id).
 *      - 200 + ack            → accepted, done.
 *      - HTTP 4xx             → definitive ComfyUI rejection (validation) —
 *        the prompt can never be queued; return 'rejected' for the caller
 *        to relay. NO probe, NO retry.
 *      - HTTP 5xx / transport throw → retryable; continue.
 *   2. Probe the pod's /queue + /history for THIS generation's extra_data
 *      (recoverPodPromptId) BEFORE re-submitting. A dispatched-but-unacked
 *      prompt is recovered by its prompt_id — the ONLY safe continuation,
 *      because a blind re-submit would run the same job twice on the pod.
 *   3. Pause, then loop — until the pod accepts, dies (a closed socket is
 *      terminal: pods never reconnect), or the retry budget expires.
 *
 * Pending-count accounting stays exactly submitPodPrompt's: a thrown
 * submission releases its count, recoverPodPromptId holds one across its
 * window (kept on success for the caller's subscribe, released when the
 * prompt is not found), and a 4xx rejection releases — so after a 'gave-up'
 * or 'rejected' outcome the pod's in-flight count is back to zero.
 *
 * onAttempt (optional) receives one human-readable line per submission
 * failure/recovery — the endpoint folds these into the generation .log.
 */
export async function submitPodPromptReliably(
    connection: PodSocketConnection,
    options: {
        promptPayload: Record<string, unknown>;
        authorization?: string;
        /** The dashboard ids the pod's extra_data echoes — the recovery key. */
        match: { workflowId: string; generationId: string };
    },
    onAttempt?: (message: string) => void
): Promise<PodPromptSubmitOutcome> {
    const deadline = Date.now() + podPromptSubmitRetryWindowMs;
    let attempts = 0;
    let lastError = 'unknown error';

    while (true) {
        // A terminated pod is terminal (pods are designed to die and never
        // reconnect — see terminate/handleSocketDeath). Retrying or probing
        // a dead socket can never succeed; fail fast with a precise reason.
        if (connection.closed) {
            return {
                kind: 'gave-up',
                attempts,
                message:
                    `Pod websocket for ${connection.key} is closed — the pod is unreachable. ` +
                    `The prompt was never accepted after ${attempts} submission attempt(s) (last error: ${lastError})`
            };
        }
        // The retry budget only bounds RETRIES — the first submission always
        // runs (attempts === 0 on the first iteration).
        if (attempts > 0 && Date.now() >= deadline) {
            return {
                kind: 'gave-up',
                attempts,
                message:
                    `The prompt was never accepted by the pod after ${attempts} submission attempt(s) ` +
                    `(last error: ${lastError})`
            };
        }

        attempts += 1;
        try {
            const { response, ack } = await submitPodPrompt(connection, {
                promptPayload: options.promptPayload,
                authorization: options.authorization
            });
            if (response.ok && ack) {
                // First-attempt acceptance is the quiet happy path — only a
                // LATE acceptance (after retries) is worth a .log line.
                if (attempts > 1) {
                    onAttempt?.(`Submission attempt ${attempts} accepted by the pod (prompt_id: ${String(ack.prompt_id)})`);
                }
                return { kind: 'accepted', ack, recovered: false };
            }
            if (response.status < 500) {
                // Definitive ComfyUI rejection (validation) — relay verbatim.
                return { kind: 'rejected', response };
            }
            // 5xx — indistinguishable between a ComfyUI hiccup and a
            // tunnel/gateway failure; retryable.
            lastError = `pod returned HTTP ${response.status}`;
        } catch (err: any) {
            // Transport failure after (possibly) dispatching — the ack may
            // be lost, so the probe below decides.
            lastError = err?.message ?? String(err);
        }
        onAttempt?.(
            `Submission attempt ${attempts} failed (${lastError}) — probing the pod's queue/history before re-submitting`
        );

        // Probe BEFORE re-submitting: if the failed attempt actually
        // dispatched, the prompt is already on the pod — resuming it by
        // prompt_id is the only safe continuation. On success this hold
        // stays (the caller's subscribe consumes it); on no-match it is
        // released again (see recoverPodPromptId).
        const promptId = await recoverPodPromptId(
            connection,
            options.match,
            { authorization: options.authorization }
        );
        if (promptId) {
            onAttempt?.(
                `Submission attempt ${attempts} lost its ack — prompt ${promptId} found on the pod's ` +
                'queue/history; tracking resumed'
            );
            return { kind: 'accepted', ack: { prompt_id: promptId }, recovered: true };
        }
        // No prompt on the pod, budget/pod-liveness re-checked at loop top —
        // one bounded pause keeps a down tunnel from being hammered.
        if (!connection.closed && Date.now() < deadline) {
            await scriptPause(Math.min(podPromptSubmitRetryPauseMs, deadline - Date.now()));
        }
    }
}

// ── Event routing (module-scope: shared by every socket generation) ────

// The event types that end a prompt's life on the pod — the SAME set
// deliverEvent uses to drain the queue registry. Centralized so the
// buffered-flush cleanup below cannot drift from the live routing.
const TERMINAL_EVENT_TYPES = new Set([
    'execution_success',
    'execution_interrupted',
    'execution_error',
    'prompt_error'
]);

function isTerminalEvent(type: string): boolean {
    return TERMINAL_EVENT_TYPES.has(type);
}

/**
 * Deliver one event to its prompt_id's subscriber(s), or buffer it.
 * Also drives the pod's QUEUE registry (the server's authoritative
 * per-instance queue): execution_start flips the entry queued → running,
 * a terminal event removes it. Queue churn never affects routing.
 */
function deliverEvent(connection: PodSocketConnection, event: StreamEvent): void {
    if (connection.closed) return;
    const pid = typeof event.data?.prompt_id === 'string' ? event.data.prompt_id : null;
    if (pid) {
        // Queue registry bookkeeping — mirrors the pod's own execution
        // state machine, for every subscriber AND for buffered orphans.
        const entry = connection.queue.get(pid);
        if (entry) {
            if (event.type === 'execution_start' && entry.status === 'queued') {
                entry.status = 'running';
                entry.startedAt = new Date().toISOString();
            } else if (isTerminalEvent(event.type)) {
                // Terminal: the pod is done with this prompt — the queue
                // drains (and the idle countdown may start).
                connection.queue.delete(pid);
                connection.submissionMeta.delete(pid);
                updateIdleTimer(connection);
            }
        }
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
    // Unattributed event (status broadcast, …) — every subscriber, the same
    // shape the old per-prompt socket consumers observed.
    for (const subscriber of connection.subscribers.values()) {
        try {
            subscriber.onEvent(event);
        } catch {
            // A crashing consumer must not break routing for others.
        }
    }
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

// ── Connection construction & socket wiring ────────────────────────────

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
        queue: new Map(),
        submissionMeta: new Map(),
        buffered: new Map(),
        heartbeat: null,
        idleTimer: null,
        closed: false
    };
    attachSocket(connection, socket);
    return connection;
}

/**
 * The ONLY writer of the pod's idle-termination countdown. The rule: while
 * the pod has NO queue entries and NO pending submissions, it gets
 * podIdleTimeoutMs of grace before the server terminates the connection;
 * any submission/queue entry cancels the countdown. A non-positive timeout
 * disables idle termination. Called from every queue/pending transition
 * (connect, submit, subscribe, release, terminal event).
 */
function updateIdleTimer(connection: PodSocketConnection): void {
    if (connection.idleTimer !== null) {
        clearTimeout(connection.idleTimer);
        connection.idleTimer = null;
    }
    if (connection.closed) return;
    if (connection.queue.size > 0 || connection.pendingSubmissions > 0) return;
    const timeoutMs = podIdleTimeoutMs;
    if (!(timeoutMs > 0)) return;
    connection.idleTimer = setTimeout(() => {
        connection.idleTimer = null;
        // A submission that landed between scheduling and firing already
        // cleared this timer — the guard is belt-and-braces only.
        if (connection.closed || connection.queue.size > 0 || connection.pendingSubmissions > 0) return;
        terminate(
            connection,
            `Pod idle — no queued prompts for ${Math.round(timeoutMs / 1000)}s (COMFY_DASHBOARD_POD_IDLE_TIMEOUT_MS)`
        );
    }, timeoutMs);
    // The idle countdown must not keep a Node process alive by itself.
    const unref = (connection.idleTimer as unknown as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(connection.idleTimer);
}

/**
 * Wire the pod's socket onto its connection: message demultiplexing,
 * heartbeat, and death handling. Preview attribution (lastExecuting*) and
 * the delivery chain live in this closure — per-connection state, since a
 * pod's socket is never replaced.
 */
function attachSocket(connection: PodSocketConnection, socket: WebSocket): void {
    // Preview attribution state — the most recent executing node/prompt,
    // exactly as ComfyUI's own prompt-event convention implies.
    let lastExecutingNode = '';
    let lastExecutingPromptId: string | null = null;

    /**
     * Text frame handling — parse + attribution update AT ARRIVAL, in the
     * message listener itself. The resulting event is delivered through the
     * ordered chain, but the parse cannot wait for its chain slot: binary
     * frames snapshot lastExecuting* at THEIR arrival, so the attribution
     * state must already reflect every text frame that arrived before them
     * (parse stays inline: shipping a decoded string to a worker and
     * cloning the parsed object back costs the same CPU on this thread).
     * Returns the event to deliver, or null for a malformed frame to drop.
     */
    const handleTextArrival = (text: string): StreamEvent | null => {
        let message: { type?: unknown; data?: unknown };
        try {
            message = JSON.parse(text) as { type?: unknown; data?: unknown };
        } catch {
            return null; // malformed text frame — nothing to route
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
        return { type, data: eventData };
    };

    /**
     * Binary frame handling — ComfyUI preview images (8-byte big-endian
     * header + raw image bytes), delivered as imagepreview.update. The
     * base64 encode is the only heavyweight step; it is delegated to
     * encodePodPayload (worker pool for large frames, inline for small).
     * `stamp` is the attribution SNAPSHOT taken at arrival — the async
     * encode completes after later `executing` frames may have advanced
     * lastExecuting*, so completion-time reads would mis-route previews.
     */
    const encodePreviewFrame = async (
        data: unknown,
        stamp: { node: string; promptId: string | null }
    ): Promise<void> => {
        const bytes = await frameBytes(data);
        if (!bytes || bytes.length < 8) return;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const imageKind = view.getUint32(0, false);
        const mime =
            imageKind === PREVIEW_IMAGE_JPEG ? 'image/jpeg' : imageKind === PREVIEW_IMAGE_PNG ? 'image/png' : null;
        if (!mime) return;
        const payload = bytes.subarray(8);
        if (payload.length === 0) return;

        const base64 = await encodePodPayload(payload);
        deliverEvent(connection, {
            type: 'imagepreview.update',
            data: {
                node_id: stamp.node,
                // Stamped prompt_id drives routing to JUST that subscriber;
                // absent (unknown prompt) it falls back to broadcast.
                ...(stamp.promptId ? { prompt_id: stamp.promptId } : {}),
                image: `data:${mime};base64,${base64}`
            }
        });
    };

    // Serialize DELIVERY in arrival order — subscriber state machines
    // (terminal handling in cloud-prompt.ts) depend on it. Heavy per-frame
    // WORK (base64 of previews) starts eagerly at arrival, so it overlaps
    // the frames ahead of it in the chain instead of blocking the loop
    // when its delivery slot comes up.
    let chain: Promise<void> = Promise.resolve();
    socket.addEventListener('message', (event) => {
        const data = (event as MessageEvent).data;

        if (typeof data === 'string') {
            // Parse + attribution update NOW (arrival) — see handleTextArrival.
            const parsed = handleTextArrival(data);
            // Only the DELIVERY takes an ordered chain slot.
            if (parsed) {
                chain = chain.then(() => deliverEvent(connection, parsed)).catch(() => {
                    // A dropped frame must not kill the pod's shared socket.
                });
            }
            return;
        }

        // Snapshot attribution at ARRIVAL (see encodePreviewFrame).
        const stamp = { node: lastExecutingNode, promptId: lastExecutingPromptId };
        const work = encodePreviewFrame(data, stamp);
        // Observed from birth — the chain only consumes it later, and a
        // rejection must never surface as an unhandledRejection in between.
        work.catch(() => {});
        chain = chain.then(() => work).catch(() => {
            // A dropped frame must not kill the pod's shared socket.
        });
    });

    // Transport death (remote close, TCP error, failed ping) → terminate:
    // pods are designed to never come back without the create endpoint.
    socket.addEventListener('close', (event) => {
        const code = (event as CloseEvent).code;
        const suffix = typeof code === 'number' && code > 0 ? ` (code ${code})` : '';
        handleSocketDeath(connection, socket, `ComfyUI websocket closed by the cloud server${suffix}`);
    });
    socket.addEventListener('error', () => {
        // Undici fires 'error' immediately BEFORE the paired 'close' on a
        // transport drop (websocket.js #onSocketClose) — deferring a
        // microtask lets the close handler (which carries the close code)
        // win; this only terminates for a closeless error.
        queueMicrotask(() => handleSocketDeath(connection, socket, 'ComfyUI websocket errored'));
    });

    // Liveness: protocol pings only. A quiet pod is HEALTHY — unlike the
    // removed per-prompt sockets there is intentionally no response-silence
    // watchdog; the connection lives until the cloud server ends it.
    connection.heartbeat = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) {
            handleSocketDeath(connection, socket, 'ComfyUI websocket stopped responding');
            return;
        }
        try {
            websocketPing(socket);
        } catch (error) {
            handleSocketDeath(
                connection,
                socket,
                `ComfyUI websocket stopped responding: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }, POD_WS_HEARTBEAT_MS);
    // The pod registry must not keep a Node process alive by itself.
    const unref = (connection.heartbeat as unknown as { unref?: () => void }).unref;
    if (typeof unref === 'function') unref.call(connection.heartbeat);
}

/**
 * The pod's socket died — stop its heartbeat and terminate the connection
 * IMMEDIATELY. No reconnection is attempted: cloud pods are designed to
 * terminate when idle and can never restart without the create-pod
 * endpoint, so a handshake retry would only ever fail against the already
 * destroyed pod (delaying the failure and spamming the log). The stale
 * guard (dead-socket identity / already-closed) keeps double signalling —
// e.g. undici's error+close pair — from terminating twice.
 */
function handleSocketDeath(connection: PodSocketConnection, socket: WebSocket, reason: string): void {
    if (connection.closed || connection.socket !== socket) return;
    terminate(connection, reason);
}

/**
 * Remote close/error/failed ping → fail every prompt riding the socket and
 * deregister the pod. The only way back is a fresh pod via POST
 * /v1/comfy/cloud.
 */
function terminate(connection: PodSocketConnection, reason: string): void {
    if (connection.closed) return;
    connection.closed = true;
    if (connection.heartbeat !== null) {
        clearInterval(connection.heartbeat);
        connection.heartbeat = null;
    }
    if (connection.idleTimer !== null) {
        clearTimeout(connection.idleTimer);
        connection.idleTimer = null;
    }
    if (podSockets.get(connection.key) === connection) podSockets.delete(connection.key);
    try {
        connection.socket.close();
    } catch {
        // The terminal event below is what matters.
    }
    console.error(`[cloud] Pod ${connection.key} terminated: ${reason}`);
    const terminal: StreamEvent = { type: 'prompt_error', data: { error: reason } };
    for (const subscriber of connection.subscribers.values()) {
        try {
            subscriber.onEvent(terminal);
        } catch {
            // Termination must reach every remaining subscriber.
        }
    }
    connection.subscribers.clear();
    // The pod is gone — its queue dies with it (the terminal prompt_error
    // above already carried the failure to every riding generation).
    connection.queue.clear();
    connection.submissionMeta.clear();
    connection.buffered.clear();
}
