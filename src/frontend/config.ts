// Frontend runtime timing configuration shared by dashboard polling hooks.
// Keeping these values at the frontend boundary prevents feature-local hooks
// from drifting to different polling cadences for the same server state.

// The pod registry response contains the available GPUs and each pod's
// server-managed in-flight prompt count, so this controls GPU/process-list
// refreshes through GET /v1/comfy/cloud.
export const GPU_LIST_POLL_INTERVAL_MS = 3_000;

// Generation summaries contain the current processing status shown in the
// OUTPUT tab and used to settle pod buttons, so they refresh on the same
// three-second cadence as the pod registry.
export const GENERATION_STATUS_POLL_INTERVAL_MS = 3_000;
