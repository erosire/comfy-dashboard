// Direct ComfyUI stream formatting tests.
//
// The event labels are user-facing, so the test asserts the exact text for
// the native transport envelopes and the websocket failure path.

import { describe, expect, it } from 'vitest';
import { eventSummary } from './formatting';

describe('eventSummary', () => {
    it('formats direct prompt lifecycle events without legacy transport names', () => {
        expect(eventSummary({ type: 'prompt_queued', data: { prompt_id: 'prompt-1' } })).toBe(
            '✓ Enqueued (prompt_id: prompt-1)'
        );
        expect(eventSummary({ type: 'prompt_done', data: {} })).toBe('✓ Done');
        expect(eventSummary({ type: 'prompt_error', data: { error: 'socket closed' } })).toBe(
            '✗ Websocket error: socket closed'
        );
    });
});
