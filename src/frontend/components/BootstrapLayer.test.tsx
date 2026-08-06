// BootstrapLayer tests.
//
// These tests cover the startup ordering that connects the persisted sidebar
// selection to the full workflow detail consumed by the editor.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapLayer } from './BootstrapLayer';
import { useDashboardStore } from '../context';

// React 18 requires this flag for deterministic act() warnings in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// BootstrapLayer consumes the context hook directly, so the test isolates its
// promise ordering without requiring a network-backed DashboardStoreProvider.
vi.mock('../context', () => ({
    useDashboardStore: vi.fn()
}));

const mockedUseDashboardStore = vi.mocked(useDashboardStore);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    // Each test gets a fresh React root so effects and mocked store values do
    // not leak between the persisted-selection and empty-selection cases.
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    // Unmounting flushes the effect cleanup boundary and releases the jsdom
    // container before the next test starts.
    act(() => root.unmount());
    container.remove();
    mockedUseDashboardStore.mockReset();
});

describe('BootstrapLayer workflow hydration', () => {
    it('loads the selected workflow detail after refreshing the workflow list', async () => {
        // A deferred refresh proves selectWorkflow is not called until the
        // metadata request has completed.
        let resolveRefresh!: () => void;
        const refreshWorkflows = vi.fn(() => new Promise<void>((resolve) => {
            resolveRefresh = resolve;
        }));
        const selectWorkflow = vi.fn().mockResolvedValue(undefined);
        const store = { selectedId: 'workflow-123' };
        mockedUseDashboardStore.mockReturnValue({
            store,
            refreshWorkflows,
            selectWorkflow
            // BootstrapLayer only consumes these three members; the remaining
            // provider commands are deliberately omitted from this unit harness.
        } as unknown as ReturnType<typeof useDashboardStore>);

        act(() => root.render(<BootstrapLayer />));
        expect(refreshWorkflows).toHaveBeenCalledTimes(1);
        expect(selectWorkflow).not.toHaveBeenCalled();

        await act(async () => {
            // Resolving the list request schedules the detail request in the
            // promise continuation registered by BootstrapLayer.
            resolveRefresh();
            await Promise.resolve();
        });

        expect(selectWorkflow).toHaveBeenCalledTimes(1);
        expect(selectWorkflow).toHaveBeenCalledWith('workflow-123');
    });

    it('does not load workflow detail when no workflow is selected', async () => {
        // An empty persisted selection must leave the editor on its drop zone
        // rather than issuing a detail request with an invalid id.
        let resolveRefresh!: () => void;
        const refreshWorkflows = vi.fn(() => new Promise<void>((resolve) => {
            resolveRefresh = resolve;
        }));
        const selectWorkflow = vi.fn().mockResolvedValue(undefined);
        const store = { selectedId: null };
        mockedUseDashboardStore.mockReturnValue({
            store,
            refreshWorkflows,
            selectWorkflow
            // BootstrapLayer only consumes these three members; the remaining
            // provider commands are deliberately omitted from this unit harness.
        } as unknown as ReturnType<typeof useDashboardStore>);

        act(() => root.render(<BootstrapLayer />));
        await act(async () => {
            // Complete the list request so the conditional detail branch is
            // evaluated, matching the startup sequence in production.
            resolveRefresh();
            await Promise.resolve();
        });

        expect(selectWorkflow).not.toHaveBeenCalled();
    });
});
