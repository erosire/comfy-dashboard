// =============================================================================
// GPU selection tests
//
// Pressing "New" no longer spawns directly — it opens the GpuSelectDialog,
// which offers the hardcoded GPUs (GPU_OPTIONS: "4090", "B300", "RTX6000") and hands the
// pick to usePods.handleGenerate (POST /v1/comfy/cloud with {gpu}).
//
// Verifies:
//   1. The dialog renders exactly the hardcoded GPU options and reports the
//      picked GPU key; the backdrop dismisses it without a separate cancel button.
//   2. Pod buttons show the GPU name and a numeric top-right badge while jobs
//      are queued (per-pod predicate: activeGenerationIds).
//   3. Every pod button advertises the native ComfyUI websocket transport
//      and uses the same solid border style.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { FooterActions, GpuSelectDialog } from './components';
import { GPU_OPTIONS, type PodEntry } from './components/utils';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

function render(ui: React.ReactElement): void {
    act(() => root.render(ui));
}

function click(el: Element | null): void {
    expect(el, 'expected element to exist').toBeTruthy();
    act(() => {
        el!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

function makePod(overrides: Partial<PodEntry> = {}): PodEntry {
    return {
        id: 'pod-1',
        podNumber: 1,
        name: 'A',
        pod_url: 'https://pod.example',
        status: 'ready',
        run: { status: 'idle' },
        activeGenerationIds: [],
        ...overrides
    };
}

describe('GpuSelectDialog', () => {
    it('renders exactly the hardcoded GPU options', () => {
        render(<GpuSelectDialog onSelect={vi.fn()} onCancel={vi.fn()} />);
        const options = [...container.querySelectorAll('[data-testid^="gpu-select-"]')].map((el) =>
            el.getAttribute('data-testid')
        );
        expect(options).toEqual(GPU_OPTIONS.map((gpu) => `gpu-select-${gpu}`));
        expect(options).toEqual(['gpu-select-4090', 'gpu-select-B300', 'gpu-select-RTX6000']);
    });

    it('renders above the generation preview stacking layer', () => {
        render(<GpuSelectDialog onSelect={vi.fn()} onCancel={vi.fn()} />);

        // ResultViewer uses z-index 2000, so the picker must use a higher
        // layer to keep its GPU controls selectable over the preview media.
        expect(getComputedStyle(container.firstElementChild as HTMLElement).zIndex).toBe('3000');
    });

    it('reports the picked GPU key', () => {
        const onSelect = vi.fn();
        render(<GpuSelectDialog onSelect={onSelect} onCancel={vi.fn()} />);

        click(container.querySelector('[data-testid="gpu-select-4090"]'));
        expect(onSelect).toHaveBeenCalledWith('4090');

        click(container.querySelector('[data-testid="gpu-select-B300"]'));
        expect(onSelect).toHaveBeenCalledWith('B300');

        click(container.querySelector('[data-testid="gpu-select-RTX6000"]'));
        expect(onSelect).toHaveBeenCalledWith('RTX6000');
    });

    it('does not render a cancel button and dismisses from the backdrop', () => {
        const onCancel = vi.fn();
        render(<GpuSelectDialog onSelect={vi.fn()} onCancel={onCancel} />);

        const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
        expect(labels).toEqual([...GPU_OPTIONS]);
        expect(labels).not.toContain('Cancel');

        // Backdrop is the outermost fixed overlay.
        click(container.firstElementChild);
        expect(onCancel).toHaveBeenCalledTimes(1);
    });
});

describe('FooterActions — GPU-labeled pod buttons', () => {
    function renderFooter(pods: PodEntry[], onGenerate = vi.fn()) {
        render(
            <FooterActions
                pods={pods}
                nodeCount={1}
                onPodGenerate={vi.fn()}
                onGenerate={onGenerate}
                onAutoGenerate={vi.fn()}
                contentTab="results"
                outputView="list"
                onOutputViewChange={vi.fn()}
            />
        );
        return onGenerate;
    }

    it('opening the GPU picker is what the plus button does', () => {
        const onGenerate = renderFooter([]);
        click([...container.querySelectorAll('button')].find((b) => b.textContent === '+')!);
        expect(onGenerate).toHaveBeenCalledTimes(1);
    });

    it('shows the list/thumbnail toggle only on the OUTPUT tab', () => {
        renderFooter([]);
        expect(container.querySelector('[data-testid="output-view-toggle"]')).toBeTruthy();

        render(
            <FooterActions
                pods={[]}
                nodeCount={1}
                onPodGenerate={vi.fn()}
                onGenerate={vi.fn()}
                onAutoGenerate={vi.fn()}
                contentTab="prompt"
                outputView="list"
                onOutputViewChange={vi.fn()}
            />
        );
        expect(container.querySelector('[data-testid="output-view-toggle"]')).toBeNull();

        render(
            <FooterActions
                pods={[]}
                nodeCount={1}
                onPodGenerate={vi.fn()}
                onGenerate={vi.fn()}
                onAutoGenerate={vi.fn()}
                contentTab="json"
                outputView="list"
                onOutputViewChange={vi.fn()}
            />
        );
        expect(container.querySelector('[data-testid="output-view-toggle"]')).toBeNull();
    });

    it('shows queued job counts as top-right badges on GPU buttons', () => {
        renderFooter([
            makePod({ id: 'p1', podNumber: 1, gpu: '4090' }),
            makePod({ id: 'p2', podNumber: 2, gpu: '4090', activeGenerationIds: ['g1', 'g2', 'g3'] }),
            makePod({ id: 'p3', podNumber: 3, gpu: 'B300', activeGenerationIds: ['g4'] })
        ]);

        expect(container.querySelector('[data-testid="pod-generate-1"]')?.textContent).toBe('4090');
        expect(container.querySelector('[data-testid="pod-generate-2"]')?.firstChild?.textContent).toBe('4090');
        expect(container.querySelector('[data-testid="pod-generate-3"]')?.firstChild?.textContent).toBe('B300');

        const idleBadge = container.querySelector('[data-testid="pod-queue-badge-1"]');
        const firstBusyBadge = container.querySelector('[data-testid="pod-queue-badge-2"]') as HTMLElement;
        const secondBusyBadge = container.querySelector('[data-testid="pod-queue-badge-3"]') as HTMLElement;
        expect(idleBadge).toBeNull();
        expect(firstBusyBadge.textContent).toBe('3');
        expect(secondBusyBadge.textContent).toBe('1');
        expect(firstBusyBadge.parentElement?.getAttribute('data-testid')).toBe('pod-generate-2');
        expect(getComputedStyle(firstBusyBadge).position).toBe('absolute');
        expect(getComputedStyle(firstBusyBadge).top).toBe('-8px');
        expect(getComputedStyle(firstBusyBadge).right).toBe('-8px');
    });

    it('draws a solid border for every native ComfyUI pod', () => {
        renderFooter([
            makePod({ id: 'p1', podNumber: 1, gpu: '4090' }),
            makePod({ id: 'p2', podNumber: 2, gpu: 'B300' })
        ]);

        const direct = container.querySelector('[data-testid="pod-generate-1"]') as HTMLElement;
        const second = container.querySelector('[data-testid="pod-generate-2"]') as HTMLElement;
        expect(getComputedStyle(direct).borderStyle).toBe('solid');
        expect(getComputedStyle(second).borderStyle).toBe('solid');
        expect(direct.getAttribute('data-transport')).toBe('websocket');
        expect(second.getAttribute('data-transport')).toBe('websocket');
    });
});
