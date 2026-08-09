// =============================================================================
// "Auto" load-balancer pick tests
//
// pickLeastLoadedPod chooses which ready pod the Auto button queues the next
// generation on: the one with the SMALLEST in-flight queue, ties going to the
// oldest pod. No eligible pod → null (the Auto button stays disabled).
//
// Verifies:
//   1. Empty / no-ready-pod lists produce null.
//   2. Spawning and url-less pods are ineligible (server-list reconciliation
//      removes dead pods outright — there is no local "error" state).
//   3. The least-loaded ready pod wins.
//   4. Ties resolve to the oldest pod (array order == spawn order).
//   5. Ineligible pods lose even with an empty queue.
// =============================================================================

import { describe, it, expect } from 'vitest';
import type { CloudPodQueueEntry } from '../../api';
import { pickLeastLoadedPod, type PodEntry } from './components/utils';

let seq = 0;
function makePod(overrides: Partial<PodEntry> = {}): PodEntry {
    seq += 1;
    return {
        id: `pod-${seq}`,
        podNumber: seq,
        name: `P${seq}`,
        pod_url: `https://pod-${seq}.example.com`,
        status: 'ready',
        run: { status: 'idle' },
        queue: [],
        ...overrides
    };
}

// A server-reported queue of length n — the ONLY queue source the balancer reads.
function jobs(n: number): CloudPodQueueEntry[] {
    return Array.from({ length: n }, (_, i) => ({
        prompt_id: `prompt-${i}`,
        number: null,
        status: 'queued' as const,
        generation_id: `gen-${i}`,
        queuedAt: '2026-08-05T10:15:30.000Z',
        startedAt: null
    }));
}

describe('pickLeastLoadedPod', () => {
    it('returns null when there are no pods at all', () => {
        expect(pickLeastLoadedPod([])).toBeNull();
    });

    it('returns null when no pod is ready (spawning / no pod_url)', () => {
        const pods = [
            makePod({ status: 'spawning', pod_url: '' }),
            makePod({ status: 'spawning' }),
            makePod({ pod_url: '' })
        ];
        expect(pickLeastLoadedPod(pods)).toBeNull();
    });

    it('picks the only ready pod', () => {
        const ready = makePod({ queue: jobs(2) });
        const pods = [makePod({ status: 'spawning', pod_url: '' }), ready];
        expect(pickLeastLoadedPod(pods)).toBe(ready);
    });

    it('picks the ready pod with the smallest in-flight queue', () => {
        const busy = makePod({ queue: jobs(3) });
        const idle = makePod({ queue: jobs(0) });
        const medium = makePod({ queue: jobs(1) });
        expect(pickLeastLoadedPod([busy, idle, medium])).toBe(idle);
        expect(pickLeastLoadedPod([busy, medium, idle])).toBe(idle);
    });

    it('breaks ties toward the oldest pod', () => {
        const first = makePod({ queue: jobs(1) });
        const second = makePod({ queue: jobs(1) });
        expect(pickLeastLoadedPod([second, first])).toBe(second);
        expect(pickLeastLoadedPod([first, second])).toBe(first);
    });

    it('ignores ineligible pods even when their queue is emptier', () => {
        const spawning = makePod({ status: 'spawning', queue: jobs(0) });
        const ready = makePod({ queue: jobs(2) });
        expect(pickLeastLoadedPod([spawning, ready])).toBe(ready);
    });
});
