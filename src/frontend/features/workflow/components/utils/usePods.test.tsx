// =============================================================================
// Direct pod idle lifecycle tests for usePods.
//
// The harness renders the actual hook, accepts one direct generation, settles
// that generation through the same polled-summary input used by the dashboard,
// and verifies the UI-facing pod list removes the direct pod after exactly
// DIRECT_POD_IDLE_MS while proxy pods remain outside this policy.
// =============================================================================

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloud, cloudPrompt } from '../../../../api';
import type { GenerationEntry, GenerationSummary } from '../../../../api';
import { usePods } from './usePods';
import { DIRECT_POD_IDLE_MS } from './constants';

// The hook's server calls are isolated so this test controls the exact direct
// pod shape and accepts the generation without network timing variability.
vi.mock('../../../../api', () => ({
    cloud: vi.fn(),
    cloudPrompt: vi.fn()
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const GENERATED_ENTRY: GenerationEntry = {
    id: 'generation-1',
    status: 'pending',
    createdDate: '2026-08-03T00:00:00.000Z',
    completedDate: null,
    generatedTime: null,
    error: null,
    prompt: { version: 1 },
    result: []
};

const COMPLETED_SUMMARY: GenerationSummary = {
    id: 'generation-1',
    status: 'completed',
    createdDate: '2026-08-03T00:00:00.000Z',
    completedDate: '2026-08-03T00:00:01.000Z',
    generatedTime: '1s',
    error: null,
    resultCount: 0,
    resultItems: []
};

let container: HTMLDivElement;
let root: Root;

function HookHarness({ generations }: { generations: GenerationSummary[] }): React.ReactElement {
    const lifecycle = usePods({
        baseUrl: '/v1/comfy',
        nodes: [{} as any],
        editingWorkflowId: 'workflow-1',
        workflowName: 'Test workflow',
        generations,
        getCurrentRaw: () => ({ version: 1 }),
        generateWorkflow: async () => GENERATED_ENTRY
    });

    return (
        <>
            <button data-testid="spawn" onClick={() => void lifecycle.handleGenerate('4090')} />
            {lifecycle.pods.map((pod) => (
                <button key={pod.id} data-testid={`pod-${pod.id}`} />
            ))}
        </>
    );
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(cloud).mockResolvedValue({ pod_url: 'https://direct.example', is_direct: true });
    vi.mocked(cloudPrompt).mockResolvedValue(new Response('{}', { status: 202 }));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe('usePods direct idle removal', () => {
    it('removes a direct pod button exactly 60 seconds after its queue settles empty', async () => {
        expect(DIRECT_POD_IDLE_MS).toBe(60_000);
        await act(async () => {
            root.render(<HookHarness generations={[]} />);
            await Promise.resolve();
        });

        await act(async () => {
            await new Promise<void>((resolve) => {
                document.querySelector('[data-testid="spawn"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                queueMicrotask(resolve);
            });
        });
        expect(container.querySelectorAll('button[data-testid^="pod-"]')).toHaveLength(1);

        await act(async () => {
            root.render(<HookHarness generations={[COMPLETED_SUMMARY]} />);
            await Promise.resolve();
        });

        act(() => {
            vi.advanceTimersByTime(DIRECT_POD_IDLE_MS - 1);
        });
        expect(container.querySelectorAll('button[data-testid^="pod-"]')).toHaveLength(1);

        await act(async () => {
            vi.advanceTimersByTime(1);
            await Promise.resolve();
        });
        expect(container.querySelectorAll('button[data-testid^="pod-"]')).toHaveLength(0);
    });

    it('does not apply direct idle removal to a proxy pod', async () => {
        vi.mocked(cloud).mockResolvedValue({ pod_url: 'https://proxy.example', is_direct: false });

        await act(async () => {
            root.render(<HookHarness generations={[]} />);
            await Promise.resolve();
        });
        await act(async () => {
            document.querySelector('[data-testid="spawn"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            await Promise.resolve();
        });

        act(() => {
            vi.advanceTimersByTime(DIRECT_POD_IDLE_MS);
        });
        expect(container.querySelectorAll('button[data-testid^="pod-"]')).toHaveLength(1);
    });
});
