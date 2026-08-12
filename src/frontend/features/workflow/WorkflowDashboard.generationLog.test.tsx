// =============================================================================
// Failed-generation log access tests
//
// OUTPUT tab debugging flow:
//   1. Clicking a FAILED (or output-less "completed") generation row/thumb
//      opens its .log trail (onShowLog) — NOT the result viewer.
//   2. Clicking a completed row with results still opens the result viewer.
//   3. Pending/processing rows stay inert (no log, no viewer yet).
//   4. The GenerationLogDialog renders the fetched log in a read-only text
//      box, wires its Copy button, and dismisses from the backdrop.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { GenerationsPane, GenerationLogDialog } from './components';
import type { GenerationSummary } from '../../api';

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

function makeGen(overrides: Partial<GenerationSummary>): GenerationSummary {
    return {
        id: 'gen-x',
        status: 'completed',
        createdDate: '2026-08-01T00:00:00.000Z',
        completedDate: '2026-08-01T00:00:10.000Z',
        generatedTime: '10.0s',
        error: null,
        resultCount: 0,
        resultItems: [],
        ...overrides
    };
}

const failedGen = makeGen({ id: 'gen-fail', status: 'failed', error: 'KSampler exploded' });
const noOutputGen = makeGen({ id: 'gen-empty', status: 'completed' });
const okGen = makeGen({
    id: 'gen-ok',
    resultCount: 1,
    resultItems: [{ type: 'image', mimeType: 'image/png', size: 123, nodeId: '9' }]
});
const pendingGen = makeGen({ id: 'gen-pending', status: 'pending', completedDate: null, generatedTime: null });

function renderPane(
    view: 'list' | 'thumbs',
    spies: { onOpenViewer: (id: string) => void; onShowLog: (id: string) => void }
) {
    render(
        <GenerationsPane
            generations={[failedGen, noOutputGen, okGen, pendingGen]}
            onOpenViewer={spies.onOpenViewer}
            onShowLog={spies.onShowLog}
            onDeleteGeneration={vi.fn()}
            view={view}
            isMobile={false}
            getResultMediaUrl={() => '/media'}
        />
    );
}

describe('GenerationsPane — failed-generation click opens the log', () => {
    it.each(['list', 'thumbs'] as const)(
        '%s view: failed/error generations open the log, results open the viewer, pending stays inert',
        (view) => {
            const spies = { onOpenViewer: vi.fn<(id: string) => void>(), onShowLog: vi.fn<(id: string) => void>() };
            renderPane(view, spies);
            const prefix = view === 'list' ? 'gen-item' : 'gen-thumb';

            // Failed run → log dialog (even though it has no results).
            click(container.querySelector(`[data-testid="${prefix}-${failedGen.id}"]`));
            expect(spies.onShowLog).toHaveBeenCalledWith(failedGen.id);
            expect(spies.onOpenViewer).not.toHaveBeenCalled();

            // Output-less "completed" run → also treated as failed → log.
            click(container.querySelector(`[data-testid="${prefix}-${noOutputGen.id}"]`));
            expect(spies.onShowLog).toHaveBeenCalledWith(noOutputGen.id);
            expect(spies.onOpenViewer).not.toHaveBeenCalled();

            // Completed with results → result viewer, untouched by the log.
            click(container.querySelector(`[data-testid="${prefix}-${okGen.id}"]`));
            expect(spies.onOpenViewer).toHaveBeenCalledWith(okGen.id);
            expect(spies.onShowLog).not.toHaveBeenCalledWith(okGen.id);

            // Pending → inert.
            click(container.querySelector(`[data-testid="${prefix}-${pendingGen.id}"]`));
            expect(spies.onShowLog).not.toHaveBeenCalledWith(pendingGen.id);
            expect(spies.onOpenViewer).not.toHaveBeenCalledWith(pendingGen.id);
        }
    );
});

describe('GenerationLogDialog', () => {
    it('shows the log in a read-only text box, moves Copy left, removes Close, and wires backdrop-close', () => {
        const onCopy = vi.fn();
        const onClose = vi.fn();
        render(
            <GenerationLogDialog
                generationId="gen-fail"
                displayText="[2026-08-01T00:00:10.000Z] Terminal error: KSampler exploded"
                loading={false}
                copied={false}
                onCopy={onCopy}
                onClose={onClose}
            />
        );

        const box = container.querySelector<HTMLTextAreaElement>('[data-testid="generation-log-text"]');
        expect(box).toBeTruthy();
        expect(box!.readOnly).toBe(true);
        expect(box!.value).toContain('KSampler exploded');

        click(container.querySelector('[data-testid="generation-log-copy"]'));
        expect(onCopy).toHaveBeenCalledTimes(1);
        expect(container.querySelector('[data-testid="generation-log-close"]')).toBeNull();
        expect(container.querySelector('[data-testid="generation-log-actions"]')?.firstElementChild?.getAttribute('data-testid')).toBe(
            'generation-log-copy'
        );

        // Backdrop click dismisses.
        click(container.querySelector('[data-testid="generation-log-dialog"]'));
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('reflects the copied feedback and disables Copy while loading', () => {
        render(
            <GenerationLogDialog
                generationId="gen-fail"
                displayText="Loading log…"
                loading
                copied={false}
                onCopy={vi.fn()}
                onClose={vi.fn()}
            />
        );
        const copyBtn = container.querySelector<HTMLButtonElement>('[data-testid="generation-log-copy"]')!;
        expect(copyBtn.disabled).toBe(true);

        render(
            <GenerationLogDialog
                generationId="gen-fail"
                displayText="log body"
                loading={false}
                copied
                onCopy={vi.fn()}
                onClose={vi.fn()}
            />
        );
        expect(container.querySelector('[data-testid="generation-log-copy"]')!.textContent).toContain('Copied');
    });

    it('offers plus and existing pod retry buttons without a Close action', () => {
        const onGenerate = vi.fn();
        const onPodGenerate = vi.fn();
        render(
            <GenerationLogDialog
                generationId="gen-fail"
                displayText="terminal error"
                loading={false}
                copied={false}
                onCopy={vi.fn()}
                onGenerate={onGenerate}
                onPodGenerate={onPodGenerate}
                pods={[
                    {
                        id: 'pod-1',
                        podNumber: 1,
                        name: 'A',
                        gpu: '4090',
                        pod_url: 'https://pod.example',
                        status: 'ready',
                        queue: [],
                        run: { status: 'idle' }
                    }
                ]}
                onClose={vi.fn()}
            />
        );

        expect(container.querySelector('[data-testid="generation-log-close"]')).toBeNull();
        click(container.querySelector('[data-testid="generation-log-generate"]'));
        click(container.querySelector('[data-testid="generation-log-pod-1"]'));
        expect(onGenerate).toHaveBeenCalledTimes(1);
        expect(onPodGenerate).toHaveBeenCalledTimes(1);
    });
});
