// Worker-thread base64 encoder pool for the pod websocket pipeline.
//
// Why this exists (see pod-socket.ts for the socket lifecycle): the
// persistent pod socket demultiplexes EVERY prompt's events — including
// binary preview frames that must be base64-encoded before delivery. That
// encode is pure synchronous CPU on the event loop; for multi-MB frames it
// stalls the loop long enough to delay protocol ping writes and socket
// reads (undici's receiver answers PINGs from the same loop), which is
// exactly how an otherwise-healthy connection drifts into the proxy-side
// TCP drops that used to kill whole generations.
//
// Encoding is therefore pushed onto a tiny node:worker_threads pool so the
// main thread keeps servicing socket IO. The payload is COPIED into an
// owned buffer and transferred (zero-copy handoff); the worker returns the
// base64 string.
//
// The pool is purely an optimization — it NEVER fails a caller:
//   - payloads below POD_WS_BASE64_OFFLOAD_THRESHOLD encode inline (the
//     worker round-trip costs more than the encode itself at that size);
//   - if workers cannot spawn (restricted runtime, mocked environment) or a
//     worker dies mid-job, the job is completed inline on the main thread.
//
// Workers are created lazily on the first large payload and unref()ed so
// the pool can never keep the server process (or a test run) alive.

import os from 'node:os';
import { Worker } from 'node:worker_threads';

/**
 * Payloads smaller than this encode inline: `Buffer.toString('base64')`
 * costs microseconds at this scale while a worker round-trip costs ~1ms.
 */
export const POD_WS_BASE64_OFFLOAD_THRESHOLD = 128 * 1024;

// Hard cap on pooled workers — base64 bursts are short; two workers already
// keep the encode fully off the loop while a KSampler preview stream flows.
const MAX_WORKERS = Math.min(2, Math.max(1, (os.cpus().length || 2) - 1));

/**
 * Plain-JavaScript worker source, executed via `new Worker(src, {eval})` —
 * deliberately NOT a .ts worker file so the pool works identically under
 * vite-node, tsx, vitest, and plain node without loader-specific worker
 * resolution. Receives {id, payload(ArrayBuffer)} and answers
 * {id, value} or {id, error}.
 */
const WORKER_SOURCE = `
'use strict';
const { parentPort } = require('node:worker_threads');
parentPort.on('message', (job) => {
    const { id, payload } = job;
    try {
        const buffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
        parentPort.postMessage({ id, value: buffer.toString('base64') });
    } catch (error) {
        parentPort.postMessage({ id, error: String(error && error.message ? error.message : error) });
    }
});
`;

type PendingJob = {
    /** Original bytes — retained so a dead worker can be retried inline. */
    payload: Uint8Array;
    resolve: (value: string) => void;
};

type PoolWorker = {
    worker: Worker;
    /** Jobs handed to this worker and not yet answered, id → job. */
    pending: Map<number, PendingJob>;
};

let workers: PoolWorker[] = [];
let roundRobin = 0;
let nextJobId = 1;
// Set when worker construction throws — the environment can't run workers
// (tests mock node:worker_threads, restricted sandboxes). Permanent: if
// spawning failed once it will keep failing, and inline is always correct.
let poolDisabled = false;

/** Encode bytes to base64 on the main thread (small payloads / fallback). */
function encodeInline(payload: Uint8Array): string {
    return Buffer.from(payload).toString('base64');
}

/** Fail-soft: complete every job stuck on a broken worker inline. */
function drainWorkerInline(poolWorker: PoolWorker): void {
    for (const job of poolWorker.pending.values()) {
        try {
            job.resolve(encodeInline(job.payload));
        } catch {
            // base64 of valid bytes cannot throw — resolve must not crash.
        }
    }
    poolWorker.pending.clear();
}

function spawnWorker(): PoolWorker | null {
    try {
        const worker = new Worker(WORKER_SOURCE, { eval: true });
        const poolWorker: PoolWorker = { worker, pending: new Map() };

        worker.on('message', (result: { id: number; value?: string; error?: string }) => {
            const job = poolWorker.pending.get(result.id);
            if (!job) return;
            poolWorker.pending.delete(result.id);
            if (typeof result.value === 'string') {
                job.resolve(result.value);
            } else {
                // The worker itself could not encode — retry inline rather
                // than failing a pod over a codec hiccup.
                job.resolve(encodeInline(job.payload));
            }
        });

        const onWorkerGone = () => {
            workers = workers.filter((entry) => entry !== poolWorker);
            drainWorkerInline(poolWorker);
            try {
                void worker.terminate();
            } catch {
                // Best-effort — the worker is already gone.
            }
        };
        worker.on('error', onWorkerGone);
        worker.on('exit', (code) => {
            if (code !== 0) onWorkerGone();
        });

        // The pool must never keep a Node process alive by itself.
        worker.unref();
        return poolWorker;
    } catch {
        poolDisabled = true;
        return null;
    }
}

/**
 * Encode bytes to base64 — pooled worker thread for large payloads, inline
 * for small ones or whenever the pool is unavailable. NEVER rejects.
 */
export function encodePodPayload(payload: Uint8Array): Promise<string> {
    if (payload.length < POD_WS_BASE64_OFFLOAD_THRESHOLD || poolDisabled) {
        return Promise.resolve(encodeInline(payload));
    }

    // Grow the pool on demand; afterwards round-robin so back-to-back large
    // previews (KSampler steps) overlap on separate threads.
    if (workers.length < MAX_WORKERS) {
        const spawned = spawnWorker();
        if (spawned) workers.push(spawned);
    }
    const target = workers.length > 0 ? workers[roundRobin++ % workers.length] : null;
    if (!target) return Promise.resolve(encodeInline(payload));

    const id = nextJobId++;
    return new Promise<string>((resolve) => {
        target.pending.set(id, { payload, resolve });
        try {
            // Copy into an OWNED buffer — the source may view a larger pool
            // allocation (undici frames), which must not be neutered by the
            // transfer.
            const owned = new Uint8Array(payload);
            target.worker.postMessage({ id, payload: owned.buffer }, [owned.buffer]);
        } catch {
            target.pending.delete(id);
            resolve(encodeInline(payload));
        }
    });
}

/** Test diagnostics — worker count, in-flight jobs, disabled flag. */
export function __podBase64PoolStats(): { workers: number; pending: number; disabled: boolean; maxWorkers: number } {
    return {
        workers: workers.length,
        pending: workers.reduce((total, entry) => total + entry.pending.size, 0),
        disabled: poolDisabled,
        maxWorkers: MAX_WORKERS
    };
}
