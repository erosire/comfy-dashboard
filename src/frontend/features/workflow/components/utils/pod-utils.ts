// Pod naming & payload helpers for the workflow dashboard.

import type { PodEntry } from './types';

/** Approximate byte size of a base64 payload (accounts for padding). */
export function base64ByteSize(b64: string): number {
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** Human-readable byte size (e.g. "512 B", "1.2 KB", "3.4 MB"). */
export function formatByteSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '?';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb >= 100 ? Math.round(gb) : gb.toFixed(1)} GB`;
}

/**
 * Spreadsheet-style pod letter for the pod button: 1 → A, 2 → B, …
 * 26 → Z, 27 → AA. Derived from the monotonic podNumber.
 */
export function podLetter(podNumber: number): string {
    let n = Math.max(1, podNumber);
    let letters = '';
    while (n > 0) {
        letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
        n = Math.floor((n - 1) / 26);
    }
    return letters;
}

/**
 * Pod button label — the pod's GPU name. Pods predating GPU selection
 * (gpu undefined) fall back to the old letter label (A00 / A03), because
 * they do not have a GPU name that can be displayed separately from a badge.
 */
export function podButtonLabel(pod: PodEntry, inFlight: number): string {
    if (pod.gpu) return pod.gpu;
    return `${podLetter(pod.podNumber)}${String(inFlight).padStart(2, '0')}`;
}

/**
 * Queue badge text — GPU-backed buttons show only the numeric in-flight count
 * in the corner badge; idle buttons and legacy pods do not render a badge.
 */
export function podButtonQueueBadge(pod: PodEntry, inFlight: number): string | null {
    if (!pod.gpu || inFlight <= 0) return null;
    return String(inFlight);
}

/**
 * Heartbeat eligibility for native ComfyUI pods. The websocket-backed status
 * probe runs for every resolved pod so a dropped connection is visible in the
 * button state before a user queues another generation.
 */
export function shouldProbePod(p: PodEntry): boolean {
    if (p.status === 'spawning' || !p.pod_url) return false;
    return true;
}

/**
 * A native pod is locally idle once its accepted generation queue is empty.
 * Pending submissions are handled separately by the hook before this check.
 */
export function isPodIdle(p: PodEntry): boolean {
    return p.status !== 'spawning' && Boolean(p.pod_url) && p.activeGenerationIds.length === 0;
}

/**
 * "Auto" load-balancer pick — the eligible pod with the SMALLEST in-flight
 * queue. Eligibility mirrors the pod buttons themselves: status 'ready'
 * with a resolved pod_url and no heartbeat strikes blocking it. Ties go to
 * the oldest pod (array order == spawn order). Null when nothing can take
 * a job — the Auto button stays disabled until a pod is ready.
 */
export function pickLeastLoadedPod(pods: PodEntry[]): PodEntry | null {
    let best: PodEntry | null = null;
    for (const p of pods) {
        if (p.status !== 'ready' || !p.pod_url) continue;
        if (!best || p.activeGenerationIds.length < best.activeGenerationIds.length) {
            best = p;
        }
    }
    return best;
}
