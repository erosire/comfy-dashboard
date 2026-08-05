// =============================================================================
// Worker-thread base64 pool tests (endpoints/cloud/pod-base64-pool.ts).
//
// Real worker_threads are used (no mocks): a small payload must encode
// INLINE (no worker ever spawns — round-trip overhead dominates), a large
// payload must encode on the pool with EXACTLY Buffer.toString('base64')
// output, and the pool must not grow past its cap under repeated bursts.
// The inline-fallback path (workers unavailable) lives in
// pod-base64-pool.fallback.test.ts.
// =============================================================================

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { __podBase64PoolStats, encodePodPayload, POD_WS_BASE64_OFFLOAD_THRESHOLD } from './pod-base64-pool';

/** Deterministic byte pattern — large enough to force the pooled path. */
function largePayload(size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) % 256;
    return bytes;
}

describe('encodePodPayload', () => {
    it('encodes small payloads inline and large payloads on the worker pool with identical output', async () => {
        // Small payload — below the offload threshold: exact output, and NO
        // worker is ever spawned (the round-trip would cost more than the
        // encode itself).
        const small = new Uint8Array([0, 1, 2, 137, 80, 78, 71, 250, 251, 252, 253, 254, 255]);
        expect(await encodePodPayload(small)).toBe(Buffer.from(small).toString('base64'));
        expect(__podBase64PoolStats().workers).toBe(0);

        // Large payload #1 — at threshold size: pooled worker, exact output.
        const large1 = largePayload(POD_WS_BASE64_OFFLOAD_THRESHOLD);
        expect(await encodePodPayload(large1)).toBe(Buffer.from(large1).toString('base64'));
        expect(__podBase64PoolStats().workers).toBe(1);

        // Large payload #2 — the pool grows to its cap, output stays exact.
        const large2 = largePayload(POD_WS_BASE64_OFFLOAD_THRESHOLD + 512);
        expect(await encodePodPayload(large2)).toBe(Buffer.from(large2).toString('base64'));
        expect(__podBase64PoolStats().workers).toBe(__podBase64PoolStats().maxWorkers);

        // Large payload #3 — the pool does NOT grow past its cap; every job
        // was answered (nothing left in flight).
        const large3 = largePayload(POD_WS_BASE64_OFFLOAD_THRESHOLD * 2);
        expect(await encodePodPayload(large3)).toBe(Buffer.from(large3).toString('base64'));
        const stats = __podBase64PoolStats();
        expect(stats.workers).toBe(stats.maxWorkers);
        expect(stats.pending).toBe(0);
        expect(stats.disabled).toBe(false);
    });
});
