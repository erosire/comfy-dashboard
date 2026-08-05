// Shared constants for the workflow dashboard feature.

/** Minimum swipe distance (px) before it counts as viewer navigation. */
export const VIEWER_SWIPE_THRESHOLD_PX = 50;

/** Maximum number of workflow items to display in the sidebar. */
export const MAX_SIDEBAR_ITEMS = 100;

/**
 * Server pod-list poll interval (GET /v1/comfy/cloud). The list response is
 * the ONLY liveness source for pod buttons: pods the server no longer lists
 * have dead sockets (the server already exhausted its reconnect schedule)
 * and their buttons are removed on that tick. There are NO per-pod client
 * probes — the server's persistent-websocket registry is authoritative.
 */
export const POD_LIST_POLL_MS = 30_000;

/**
 * Dim accent track for the pod button's circular loading border — the
 * static border color while the sg-ring-loading arc sweeps over it.
 */
export const POD_RING_TRACK = 'rgba(129, 140, 248, 0.30)';

/**
 * GPU options offered by the New-pod dialog, hardcoded for now. These are
 * the keys of comfyCloudServiceEndpoint (runtime/secret/private/modal/
 * comfy.ts) — more GPUs land there first, then join this list.
 */
export const GPU_OPTIONS = ['4090', 'B300', 'RTX6000'] as const;
