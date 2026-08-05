// =============================================================================
// Thumbs-gallery ordering tests
//
// The thumbs view is an ORDERED masonry: generations are dealt round-robin
// into per-column flex stacks (column = index % columnCount), so the grid
// reads ROW-major — left to right, then down — and the newest generation
// (array index 0) always renders top-left on the top row. Plain CSS
// column-count fills column-major (top-to-bottom first) and buries the
// newest mid-page; these tests pin the row-major DOM placement.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { GenerationsPane } from './components';
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

function makeGen(id: string): GenerationSummary {
    return {
        id,
        status: 'completed',
        createdDate: '2026-08-01T00:00:00.000Z',
        completedDate: '2026-08-01T00:00:10.000Z',
        generatedTime: '10.0s',
        error: null,
        resultCount: 1,
        resultItems: [{ type: 'image', mimeType: 'image/png', size: 123, nodeId: '9' }]
    };
}

// Newest first — the order the dashboard feeds the pane after sorting.
const generations = ['gen-a', 'gen-b', 'gen-c', 'gen-d', 'gen-e', 'gen-f'].map(makeGen);

function renderThumbs(isMobile: boolean): void {
    render(
        <GenerationsPane
            generations={generations}
            onOpenViewer={vi.fn()}
            onShowLog={vi.fn()}
            onDeleteGeneration={vi.fn()}
            view="thumbs"
            isMobile={isMobile}
            getResultMediaUrl={() => '/media'}
        />
    );
}

/** Testids of the thumb cards inside one masonry column, top to bottom. */
function columnIds(columnIndex: number): string[] {
    const column = container.querySelector(`[data-testid="results-thumb-column-${columnIndex}"]`);
    expect(column, `expected column ${columnIndex} to exist`).toBeTruthy();
    return Array.from(column!.querySelectorAll('[data-testid^="gen-thumb-"]')).map((el) =>
        el.getAttribute('data-testid')!.replace('gen-thumb-', '')
    );
}

describe('GenerationsPane — thumbs gallery fills left-to-right, then down', () => {
    it('desktop: deals 6 generations round-robin across 4 columns (newest top-left)', () => {
        renderThumbs(false);

        // Exactly 4 column stacks, in order.
        const grid = container.querySelector('[data-testid="results-thumb-grid"]');
        expect(
            Array.from(grid!.children).map((el) => el.getAttribute('data-testid'))
        ).toEqual([
            'results-thumb-column-0',
            'results-thumb-column-1',
            'results-thumb-column-2',
            'results-thumb-column-3'
        ]);

        // Column c holds indices c, c+4 → the visual top row reads
        // gen-a gen-b gen-c gen-d (left→right), row 2 reads gen-e gen-f.
        expect(columnIds(0)).toEqual(['gen-a', 'gen-e']);
        expect(columnIds(1)).toEqual(['gen-b', 'gen-f']);
        expect(columnIds(2)).toEqual(['gen-c']);
        expect(columnIds(3)).toEqual(['gen-d']);
    });

    it('mobile: deals across 2 columns — odds left, evens right', () => {
        renderThumbs(true);

        const grid = container.querySelector('[data-testid="results-thumb-grid"]');
        expect(
            Array.from(grid!.children).map((el) => el.getAttribute('data-testid'))
        ).toEqual(['results-thumb-column-0', 'results-thumb-column-1']);

        // Top row: gen-a gen-b; then gen-c gen-d; then gen-e gen-f.
        expect(columnIds(0)).toEqual(['gen-a', 'gen-c', 'gen-e']);
        expect(columnIds(1)).toEqual(['gen-b', 'gen-d', 'gen-f']);
    });
});
