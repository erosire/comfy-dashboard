// =============================================================================
// Media-kind badge tests
//
// OUTPUT tab: every generation WITH results carries a colored kind badge
// (VIDEO / AUDIO / IMAGE) marking the DOMINANT kind of its result items.
// A run can emit several kinds at once — priority is video > audio >
// image (video+audio+image → video, audio+image → audio, ...). Runs with
// no results (pending/failed/no-output) show no badge.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { GenerationsPane } from './components';
import { generationMediaKind } from './components/utils';
import type { GenerationResultMeta, GenerationSummary } from '../../api';

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

const img: GenerationResultMeta = { type: 'image', mimeType: 'image/png', size: 1, nodeId: '1' };
const aud: GenerationResultMeta = { type: 'audio', mimeType: 'audio/mp3', size: 1, nodeId: '2' };
const vid: GenerationResultMeta = { type: 'video', mimeType: 'video/mp4', size: 1, nodeId: '3' };

describe('generationMediaKind', () => {
    it('resolves the dominant kind by priority video > audio > image', () => {
        expect(generationMediaKind({ resultItems: [vid] })).toBe('video');
        expect(generationMediaKind({ resultItems: [aud] })).toBe('audio');
        expect(generationMediaKind({ resultItems: [img] })).toBe('image');
    });

    it('marks mixed runs with the highest kind present', () => {
        // Video + audio + image → video.
        expect(generationMediaKind({ resultItems: [img, aud, vid] })).toBe('video');
        // Video + image → video.
        expect(generationMediaKind({ resultItems: [img, vid] })).toBe('video');
        // Audio + image → audio.
        expect(generationMediaKind({ resultItems: [img, aud] })).toBe('audio');
        // Multiple items of one kind → that kind.
        expect(generationMediaKind({ resultItems: [img, img] })).toBe('image');
    });

    it('returns null when the run produced nothing', () => {
        expect(generationMediaKind({ resultItems: [] })).toBeNull();
        // Defensive: a malformed entry with no array at all.
        expect(generationMediaKind({} as Pick<GenerationSummary, 'resultItems'>)).toBeNull();
    });
});

describe('GenerationsPane — media-kind badge', () => {
    const gens = [
        makeGen({ id: 'gen-all', resultCount: 3, resultItems: [img, aud, vid] }),
        makeGen({ id: 'gen-au-img', resultCount: 2, resultItems: [img, aud] }),
        makeGen({ id: 'gen-img', resultCount: 1, resultItems: [img] }),
        makeGen({ id: 'gen-pending', status: 'pending', completedDate: null, generatedTime: null })
    ];

    function renderPane(view: 'list' | 'thumbs') {
        render(
            <GenerationsPane
                generations={gens}
                onOpenViewer={vi.fn()}
                onShowLog={vi.fn()}
                onDeleteGeneration={vi.fn()}
                view={view}
                isMobile={false}
                getResultMediaUrl={() => '/media'}
            />
        );
    }

    function badgeText(id: string): string | null {
        return container.querySelector(`[data-testid="gen-kind-${id}"]`)?.textContent ?? null;
    }

    it.each(['list', 'thumbs'] as const)('%s view: badges the dominant kind, highest kind wins', (view) => {
        renderPane(view);

        // video + audio + image → VIDEO.
        expect(badgeText('gen-all')).toBe('video');
        // audio + image → AUDIO.
        expect(badgeText('gen-au-img')).toBe('audio');
        // image only → IMAGE.
        expect(badgeText('gen-img')).toBe('image');
        // No results yet → no badge.
        expect(badgeText('gen-pending')).toBeNull();
    });
});
