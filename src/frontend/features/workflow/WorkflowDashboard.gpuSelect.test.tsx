// =============================================================================
// GPU selection tests
//
// Pressing "New" no longer spawns directly — it opens the GpuSelectDialog,
// which offers the hardcoded GPUs (GPU_OPTIONS: "4090", "B300") and hands the
// pick to usePods.handleGenerate (POST /v1/comfy/cloud with {gpu}).
//
// Verifies:
//   1. The dialog renders exactly the hardcoded GPU options and reports the
//      picked GPU key; Cancel and the backdrop dismiss it.
//   2. Pod buttons are labeled by GPU — "4090" idle, "4090x3" / "B300x1"
//      while jobs are queued (per-pod predicate: activeGenerationIds).
//   3. The pod button border STYLE carries the pod shape: solid = direct
//      ComfyUI, dashed = Tier 2 proxy.
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
        failCount: 0,
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
        expect(options).toEqual(['gpu-select-4090', 'gpu-select-B300']);
    });

    it('reports the picked GPU key', () => {
        const onSelect = vi.fn();
        render(<GpuSelectDialog onSelect={onSelect} onCancel={vi.fn()} />);

        click(container.querySelector('[data-testid="gpu-select-4090"]'));
        expect(onSelect).toHaveBeenCalledWith('4090');

        click(container.querySelector('[data-testid="gpu-select-B300"]'));
        expect(onSelect).toHaveBeenCalledWith('B300');
    });

    it('dismisses from Cancel and from the backdrop', () => {
        const onCancel = vi.fn();
        render(<GpuSelectDialog onSelect={vi.fn()} onCancel={onCancel} />);

        click([...container.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!);
        expect(onCancel).toHaveBeenCalledTimes(1);

        // Backdrop is the outermost fixed overlay.
        click(container.firstElementChild);
        expect(onCancel).toHaveBeenCalledTimes(2);
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
                outputView="list"
                onOutputViewChange={vi.fn()}
            />
        );
        return onGenerate;
    }

    it('opening the GPU picker is what the New button does', () => {
        const onGenerate = renderFooter([]);
        click([...container.querySelectorAll('button')].find((b) => b.textContent === 'New')!);
        expect(onGenerate).toHaveBeenCalledTimes(1);
    });

    it('labels each pod with its GPU and the queued job count while busy', () => {
        renderFooter([
            makePod({ id: 'p1', podNumber: 1, gpu: '4090' }),
            makePod({ id: 'p2', podNumber: 2, gpu: '4090', activeGenerationIds: ['g1', 'g2', 'g3'] }),
            makePod({ id: 'p3', podNumber: 3, gpu: 'B300', activeGenerationIds: ['g4'] })
        ]);

        const labels = [1, 2, 3].map(
            (n) => container.querySelector(`[data-testid="pod-generate-${n}"]`)!.textContent
        );
        expect(labels).toEqual(['4090', '4090x3', 'B300x1']);
    });

    it('draws a solid border for direct pods and a dashed border for proxy pods', () => {
        renderFooter([
            makePod({ id: 'p1', podNumber: 1, gpu: '4090', is_direct: true }),
            makePod({ id: 'p2', podNumber: 2, gpu: 'B300', is_direct: false })
        ]);

        const direct = container.querySelector('[data-testid="pod-generate-1"]') as HTMLElement;
        const proxy = container.querySelector('[data-testid="pod-generate-2"]') as HTMLElement;
        expect(direct.style.borderStyle).toBe('solid');
        expect(proxy.style.borderStyle).toBe('dashed');
        expect(direct.getAttribute('data-direct')).toBe('direct');
        expect(proxy.getAttribute('data-direct')).toBe('proxy');
    });
});
