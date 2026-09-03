// Frontend polling configuration tests.
//
// These exact values protect the shared cadence used by both the GPU/pod
// registry poll and the selected-workflow generation-status poll, plus the
// host-aware default baseUrl resolution (localhost pages must stay on the
// localhost domain instead of crossing to the LAN IP).

import { describe, expect, it } from 'vitest';
import { LOCAL_AREA_NETWORK_HOST_NAME, LOCAL_AREA_NETWORK_DATABASE_PORT } from '@config/environment';
import { GENERATION_STATUS_POLL_INTERVAL_MS, GPU_LIST_POLL_INTERVAL_MS, resolveDefaultBaseUrl } from './config';

describe('frontend polling configuration', () => {
    it('uses a three-second interval for both server state lists', () => {
        expect({ GPU_LIST_POLL_INTERVAL_MS, GENERATION_STATUS_POLL_INTERVAL_MS }).toEqual({
            GPU_LIST_POLL_INTERVAL_MS: 3_000,
            GENERATION_STATUS_POLL_INTERVAL_MS: 3_000
        });
    });
});

describe('resolveDefaultBaseUrl', () => {
    // Exact URLs resolved per host domain — the LAN fallback is the default,
    // localhost is the one domain that swaps the IP for the loopback name.
    const LOCALHOST_URL = `http://localhost:${LOCAL_AREA_NETWORK_DATABASE_PORT}/v1/comfy`;
    const LAN_URL = `http://${LOCAL_AREA_NETWORK_HOST_NAME}:${LOCAL_AREA_NETWORK_DATABASE_PORT}/v1/comfy`;

    it('uses the localhost domain when the page host domain is localhost', () => {
        expect(resolveDefaultBaseUrl('localhost')).toBe(LOCALHOST_URL);
    });

    it('falls back to the LAN IP for a LAN-hosted page', () => {
        expect(resolveDefaultBaseUrl(LOCAL_AREA_NETWORK_HOST_NAME)).toBe(LAN_URL);
    });

    it('falls back to the LAN IP for a custom-domain-hosted page', () => {
        expect(resolveDefaultBaseUrl('dashboard.example.com')).toBe(LAN_URL);
    });

    it('falls back to the LAN IP for the 127.0.0.1 IP (only the exact localhost domain swaps)', () => {
        expect(resolveDefaultBaseUrl('127.0.0.1')).toBe(LAN_URL);
    });

    it('matches localhost exactly (case-sensitive, no subdomain prefix)', () => {
        expect(resolveDefaultBaseUrl('LOCALHOST')).toBe(LAN_URL);
        expect(resolveDefaultBaseUrl('app.localhost')).toBe(LAN_URL);
    });

    it('falls back to the LAN IP when no hostname is available (non-browser import)', () => {
        expect(resolveDefaultBaseUrl('')).toBe(LAN_URL);
    });

    it('reads window.location.hostname when no hostname is injected (jsdom defaults to localhost)', () => {
        // Pins the production call-site path (context/store.tsx and
        // WorkflowDashboard default prop) — jsdom serves http://localhost:3000/.
        expect(window.location.hostname).toBe('localhost');
        expect(resolveDefaultBaseUrl()).toBe(LOCALHOST_URL);
    });
});


