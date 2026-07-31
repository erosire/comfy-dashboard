// Shared constants for the workflow dashboard feature.

/** Minimum swipe distance (px) before it counts as viewer navigation. */
export const VIEWER_SWIPE_THRESHOLD_PX = 50;

/** Maximum number of workflow items to display in the sidebar. */
export const MAX_SIDEBAR_ITEMS = 10;

/** Heartbeat probe interval — keeps pods warm and detects dead pod_urls. */
export const POD_HEARTBEAT_MS = 30_000;

/** Consecutive heartbeat failures before a dead pod removes itself. */
export const MAX_POD_FAILURES = 2;

/**
 * Dim accent track for the pod button's circular loading border — the
 * static border color while the sg-ring-loading arc sweeps over it.
 * Matches the SpinnerEl track alpha.
 */
export const POD_RING_TRACK = 'rgba(129, 140, 248, 0.30)';
