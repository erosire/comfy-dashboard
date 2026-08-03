// =============================================================================
// Pod heartbeat eligibility tests.
//
// The keepalive/strike heartbeat is a Tier 2 PROXY pod concept (scale-to-zero
// idle timer + dead-pod garbage collection). DIRECT ComfyUI pods — standalone
// native servers — are exempt.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { podButtonLabel, podButtonQueueBadge, shouldHeartbeatPod } from './pod-utils';
import type { PodEntry } from './types';

function pod(overrides: Partial<PodEntry> = {}): PodEntry {
    return {
        id: 'pod-1',
        podNumber: 1,
        name: 'A',
        pod_url: 'https://pod.example',
        status: 'ready',
        failCount: 0,
        run: { status: 'idle' },
        activeGenerationIds: [],
        ...overrides
    };
}

describe('shouldHeartbeatPod', () => {
    it('exempts direct ComfyUI pods — no idle timer to reset, no proxy to poll', () => {
        expect(shouldHeartbeatPod(pod({ is_direct: true }))).toBe(false);
    });

    it('probes proxy pods', () => {
        expect(shouldHeartbeatPod(pod({ is_direct: false }))).toBe(true);
    });

    it('probes pods whose shape is not detected yet (the probe resolves is_direct)', () => {
        expect(shouldHeartbeatPod(pod({ is_direct: undefined }))).toBe(true);
    });

    it('skips spawning pods and pods without a resolved pod_url', () => {
        expect(shouldHeartbeatPod(pod({ status: 'spawning', pod_url: '' }))).toBe(false);
        expect(shouldHeartbeatPod(pod({ status: 'spawning' }))).toBe(false);
        expect(shouldHeartbeatPod(pod({ pod_url: '' }))).toBe(false);
    });

    it('still skips direct pods that are in an error state', () => {
        expect(shouldHeartbeatPod(pod({ is_direct: true, status: 'error', failCount: 1 }))).toBe(false);
    });

    it('probes proxy pods in an error state so they can recover or collect their final strike', () => {
        expect(shouldHeartbeatPod(pod({ is_direct: false, status: 'error', failCount: 1 }))).toBe(true);
    });
});

// =============================================================================
// Pod button label tests.
//
// The button row shows each GPU name with a numeric queue badge when N jobs
// are queued. Pods predating GPU selection keep the legacy letter label.
// =============================================================================

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
