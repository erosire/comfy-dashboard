// useGenerationsPolling cadence tests.
//
// The hook performs one immediate refresh for the selected workflow and then
// repeats it at the shared frontend configuration interval. Fake timers keep
// these assertions deterministic and avoid any real server communication.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATION_STATUS_POLL_INTERVAL_MS } from '../../../../config';
import { useGenerationsPolling } from './useGenerationsPolling';

// React 18 requires this flag when updates are flushed through test acts.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
});

describe('useGenerationsPolling', () => {
    it('refreshes immediately and then every three seconds for the selected workflow', async () => {
        const refreshGenerations = vi.fn().mockResolvedValue(undefined);
        const Harness: React.FC = () => {
            useGenerationsPolling('workflow-1', refreshGenerations);
            return null;
        };

        await act(async () => {
            root.render(<Harness />);
            await Promise.resolve();
        });

        expect(refreshGenerations.mock.calls).toEqual([['workflow-1']]);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(GENERATION_STATUS_POLL_INTERVAL_MS);
        });
        expect(refreshGenerations.mock.calls).toEqual([
            ['workflow-1'],
            ['workflow-1']
        ]);

        await act(async () => {
            await vi.advanceTimersByTimeAsync(GENERATION_STATUS_POLL_INTERVAL_MS * 2);
        });
        expect(refreshGenerations.mock.calls).toEqual([
            ['workflow-1'],
            ['workflow-1'],
            ['workflow-1'],
            ['workflow-1']
        ]);
    });

    it('does not poll when no workflow is selected', async () => {
        const refreshGenerations = vi.fn().mockResolvedValue(undefined);
        const Harness: React.FC = () => {
            useGenerationsPolling(null, refreshGenerations);
            return null;
        };

        await act(async () => {
            root.render(<Harness />);
            await vi.advanceTimersByTimeAsync(GENERATION_STATUS_POLL_INTERVAL_MS * 2);
        });

        expect(refreshGenerations.mock.calls).toEqual([]);
    });
});
