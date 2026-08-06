// Frontend polling configuration tests.
//
// These exact values protect the shared cadence used by both the GPU/pod
// registry poll and the selected-workflow generation-status poll.

import { describe, expect, it } from 'vitest';
import { GENERATION_STATUS_POLL_INTERVAL_MS, GPU_LIST_POLL_INTERVAL_MS } from './config';

describe('frontend polling configuration', () => {
    it('uses a three-second interval for both server state lists', () => {
        expect({ GPU_LIST_POLL_INTERVAL_MS, GENERATION_STATUS_POLL_INTERVAL_MS }).toEqual({
            GPU_LIST_POLL_INTERVAL_MS: 3_000,
            GENERATION_STATUS_POLL_INTERVAL_MS: 3_000
        });
    });
});
