// Frontend runtime configuration shared by dashboard polling hooks and the
// default API endpoint resolution.
// Keeping these values at the frontend boundary prevents feature-local hooks
// from drifting to different polling cadences for the same server state, and
// keeps the default baseUrl decision in one place (consumed by both
// context/store.tsx DEFAULT_CONFIG and WorkflowDashboard's default prop).

import { LOCAL_AREA_NETWORK_HOST_NAME, LOCAL_AREA_NETWORK_DATABASE_PORT } from '@config/environment';

// Fallback dashboard-service URL used when the page is NOT served from the
// loopback domain — the LAN deployment address of the dashboard service.
// https is required: the underload service enforces TLS for LAN peers.
const LAN_BASE_URL = `https://${LOCAL_AREA_NETWORK_HOST_NAME}:${LOCAL_AREA_NETWORK_DATABASE_PORT}/v1/comfy`;

// Loopback dashboard-service URL used when the page IS served from localhost:
// a developer opening the dashboard via http://localhost:<port> expects API
// calls to stay on the same loopback domain instead of crossing to the LAN IP.
// Plain http is fine here — the service exempts loopback peers from TLS.
const LOCALHOST_BASE_URL = `http://localhost:${LOCAL_AREA_NETWORK_DATABASE_PORT}/v1/comfy`;

// Resolve the default dashboard-service base URL from the page's host domain.
// When the host domain is "localhost" the localhost domain is used instead of
// the LAN IP address — every other host (LAN IP, custom domain, or a
// non-browser test/SSR import where window is absent) keeps the LAN default.
// `hostname` is injectable so tests can pin the branch deterministically
// (jsdom's window.location is not reassignable).
export const resolveDefaultBaseUrl = (hostname?: string): string => {
    const host = hostname ?? (typeof window === 'undefined' ? '' : window.location.hostname);
    return host === 'localhost' ? LOCALHOST_BASE_URL : LAN_BASE_URL;
};

// The pod registry response contains the available GPUs and each pod's
// server-managed in-flight prompt count, so this controls GPU/process-list
// refreshes through GET /v1/comfy/cloud.
export const GPU_LIST_POLL_INTERVAL_MS = 3_000;

// Generation summaries contain the current processing status shown in the
// OUTPUT tab and used to settle pod buttons, so they refresh on the same
// three-second cadence as the pod registry.
export const GENERATION_STATUS_POLL_INTERVAL_MS = 3_000;
