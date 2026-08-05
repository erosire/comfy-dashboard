// =============================================================================
// Worker-thread base64 pool FALLBACK tests (endpoints/cloud/pod-base64-pool.ts)
// — the environment cannot spawn workers (construction throws), so the pool
// must permanently fall back to inline main-thread encoding. Crucially,
// encodePodPayload still produces EXACT output and NEVER rejects: a codec
// hiccup must never fail a pod's generation.
//
// Separate file because vi.mock('node:worker_threads') is file-scoped and
// the pooled behavior needs the real implementation
// (pod-base64-pool.test.ts).
// =============================================================================

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

vi.mock('node:worker_threads', () => ({
    Worker: class {
        constructor() {
            throw new Error('worker_threads unavailable in this environment');
        }
    }
}));

import { __podBase64PoolStats, encodePodPayload, POD_WS_BASE64_OFFLOAD_THRESHOLD } from './pod-base64-pool';

describe('encodePodPayload — worker-spawn failure fallback', () => {
    it('falls back to inline encoding with exact output and disables the pool', async () => {
        const payload = new Uint8Array(POD_WS_BASE64_OFFLOAD_THRESHOLD * 2);
        for (let i = 0; i < payload.length; i++) payload[i] = (i * 17 + 3) % 256;

        expect(await encodePodPayload(payload)).toBe(Buffer.from(payload).toString('base64'));

        // The failed spawn disabled the pool permanently — subsequent large
        // payloads do not even attempt another worker.
        const stats = __podBase64PoolStats();
        expect(stats).toEqual({ workers: 0, pending: 0, disabled: true, maxWorkers: stats.maxWorkers });

        const second = new Uint8Array(POD_WS_BASE64_OFFLOAD_THRESHOLD + 1);
        expect(await encodePodPayload(second)).toBe(Buffer.from(second).toString('base64'));
        expect(__podBase64PoolStats().workers).toBe(0);
    });
});
