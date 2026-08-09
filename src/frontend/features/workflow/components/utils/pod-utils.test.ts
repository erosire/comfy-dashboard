// =============================================================================
// Pod button label tests.
//
// The button row shows each GPU name with a numeric queue badge when N jobs
// are queued. Pods predating GPU selection keep the legacy letter label.
// (Pod liveness is NOT tested here — it is owned entirely by the server
// pod-list reconciliation in usePods: listed = alive, unlisted = removed.)
// =============================================================================

import { describe, expect, it } from 'vitest';
import { podButtonLabel, podButtonQueueBadge } from './pod-utils';
import type { PodEntry } from './types';

function pod(overrides: Partial<PodEntry> = {}): PodEntry {
    return {
        id: 'pod-1',
        podNumber: 1,
        name: 'A',
        pod_url: 'https://pod.example',
        status: 'ready',
        run: { status: 'idle' },
        queue: [],
        ...overrides
    };
}

describe('podButtonLabel', () => {
    it('shows the bare GPU name when nothing is queued', () => {
        expect(podButtonLabel(pod({ gpu: '4090' }), 0)).toBe('4090');
        expect(podButtonLabel(pod({ gpu: 'B300' }), 0)).toBe('B300');
    });

    it('keeps the GPU label separate from its numeric queue badge', () => {
        expect(podButtonLabel(pod({ gpu: '4090' }), 3)).toBe('4090');
        expect(podButtonQueueBadge(pod({ gpu: '4090' }), 3)).toBe('3');
        expect(podButtonQueueBadge(pod({ gpu: 'B300' }), 1)).toBe('1');
        // Large counts are never clamped or prefixed with an x.
        expect(podButtonQueueBadge(pod({ gpu: '4090' }), 100)).toBe('100');
        expect(podButtonQueueBadge(pod({ gpu: '4090' }), 0)).toBeNull();
    });

    it('falls back to the legacy letter label for pods without a GPU', () => {
        expect(podButtonLabel(pod({}), 0)).toBe('A00');
        expect(podButtonLabel(pod({}), 3)).toBe('A03');
        expect(podButtonLabel(pod({ podNumber: 2 }), 12)).toBe('B12');
    });
});
