// Direct-ComfyUI pod helpers for the cloud endpoints.
//
// Every cloud pod is the native ComfyUI server, reached over ONE persistent
// websocket per pod (see pod-socket.ts — the registry owns socket lifetime,
// client-id binding, event demultiplexing, and liveness). This module keeps
// only the small shared helpers that registry and the cloud endpoints use:
//
//   - serverRoute / websocketUrl — native ComfyUI route builders that
//     preserve a pod URL's prefix path (gateways mounting ComfyUI below a
//     non-root path);
//   - waitForSocketOpen — bounded websocket handshake await;
//   - newDirectClientId — ComfyUI's documented 32-char hex id shape (one id
//     per pod socket AND per prompt subscriber);
//   - probeDirectHealth — the status document assembled for a pod whose
//     websocket is ALREADY connected (optional root HTTP check + GET
//     /system_stats enrichment). The registry socket is authoritative —
//     HTTP failures here are diagnostic only.
//
// The old per-prompt websocket transport (open a socket per prompt, wrap it
// as an NDJSON stream) was removed: pods now keep a single server-managed
// socket forever, and prompt events are demultiplexed by prompt_id in
// pod-socket.ts. Execution quiet-time is no longer treated as failure —
// only remote close/error (or a failed protocol ping), or the server's
// idle-queue timeout (pod-socket.ts, COMFY_DASHBOARD_POD_IDLE_TIMEOUT_MS),
// terminates a pod, and that death is final: pods are designed to terminate
// when idle and never restart without the create-pod endpoint, so no
// reconnect is tried.

import { randomUUID } from 'node:crypto';
import { WebSocket } from 'undici';

// Native ComfyUI websocket handshakes need a bounded default so a pending
// connection cannot stall the create endpoint forever when the pod
// disappears mid-request.
const DIRECT_SOCKET_TIMEOUT_MS = 10_000;

/**
 * Per-attempt budget for the /system_stats enrichment in probeDirectHealth.
 * A hung pod must not stall the endpoint on undici's 300 s default.
 */
export const DIRECT_STATS_PROBE_TIMEOUT_MS = 10_000;

// Preserve a pod URL's prefix path while appending a native ComfyUI route.
// This supports deployments mounted below a non-root gateway path.
export function serverRoute(podUrl: URL, route: string): URL {
    const result = new URL(podUrl.toString());
    const basePath = result.pathname.replace(/\/+$/, '');
    result.pathname = `${basePath}${route}` || route;
    return result;
}

// Convert the HTTP pod URL into the native websocket URL and bind the
// pod's shared client id so ComfyUI routes its prompt execution events to
// this one persistent socket.
export function websocketUrl(podUrl: URL, clientId: string): string {
    const result = serverRoute(podUrl, '/ws');
    result.protocol = result.protocol === 'https:' ? 'wss:' : 'ws:';
    result.searchParams.set('clientId', clientId);
    return result.toString();
}

// Wait for an undici websocket to open, fail, close, or exceed its deadline.
// The ready-state check after listener registration handles synchronous/fake
// websocket implementations that transition before listeners are attached.
export function waitForSocketOpen(socket: WebSocket, timeoutMs: number = DIRECT_SOCKET_TIMEOUT_MS): Promise<void> {
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
 * Build the direct pod status document for a pod whose persistent websocket
 * is already connected (pod-socket.ts). The native server has no model-list
 * endpoint used by this dashboard, so those fields remain empty while
 * /system_stats is copied when it answers. Root HTTP failure is diagnostic
 * only because the websocket is authoritative.
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
            // The caller's persistent websocket is already connected; root
            // HTTP is retained as a diagnostic signal and may fail
            // independently.
            healthy: true,
            checked: { http_ok: httpOk, websocket: true },
            ...(system_stats !== undefined ? { system_stats } : {})
        },
        models_dir: '',
        models: {}
    };
}
