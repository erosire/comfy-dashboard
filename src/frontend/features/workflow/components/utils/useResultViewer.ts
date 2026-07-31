// Result viewer navigation model — the full-screen image/video modal.
//
// Generation summaries carry per-result metadata (resultItems) WITHOUT
// payloads, so the viewer needs NO generation fetch at all: the media
// streams straight from
//   GET /v1/comfy/workflows/{id}/generate/{genId}/result/{index}
// which <img>/<video> consume natively. The browser handles caching and
// range-seeking against that endpoint itself — no megabytes of base64 in
// React state, no throwaway blob URLs, nothing to revoke.
//
// Navigation spine: every generation of the selected workflow that has
// results, in the SAME order as the OUTPUT tab list, snapshotted at open
// time. The viewer scrolls across the whole workflow — viewerIndex is a
// global index into the flattened result list of all these generations.
//
// Extracted from the original CloudTab.tsx viewer state.

import React from 'react';
import type { GenerationSummary } from '../../../../api';
import { generationResultUrl } from '../../../../api';
import type { ViewerEntry } from './types';

export type UseResultViewerParams = {
    /** Selected workflow id (store.selectedId) — builds the media URLs. */
    selectedId: string | null;
    /** The OUTPUT-tab generation list (store.generations). */
    generations: GenerationSummary[];
    /** API base URL (store.config.baseUrl). */
    baseUrl: string;
};

export function useResultViewer({ selectedId, generations, baseUrl }: UseResultViewerParams) {
    const [viewerOpen, setViewerOpen] = React.useState(false);
    const [viewerGens, setViewerGens] = React.useState<GenerationSummary[]>([]);
    const [viewerIndex, setViewerIndex] = React.useState(0);

    // Flattened display-metadata list across all snapshot generations —
    // viewerIndex addresses this array directly.
    const viewerEntries = React.useMemo<ViewerEntry[]>(() => {
        const flat: ViewerEntry[] = [];
        for (const gen of viewerGens) {
            (gen.resultItems ?? []).forEach((item, resultIndex) => {
                flat.push({ ...item, generationId: gen.id, resultIndex });
            });
        }
        return flat;
    }, [viewerGens]);

    // Currently displayed item.
    const viewerCurrent: ViewerEntry | undefined = viewerEntries[viewerIndex];

    // URL streaming the current item's bytes — dropped straight into
    // <img src>/<video src>.
    const viewerMediaUrl = React.useMemo(() => {
        if (!viewerOpen || !viewerCurrent || !selectedId) return null;
        return generationResultUrl(baseUrl, selectedId, viewerCurrent.generationId, viewerCurrent.resultIndex);
    }, [viewerOpen, viewerCurrent, selectedId, baseUrl]);

    const openViewer = React.useCallback(
        (startGenerationId: string) => {
            if (!selectedId) return;
            // Generations with viewable results, in Results-tab order.
            const gens = generations.filter((g) => (g.resultItems?.length ?? 0) > 0);
            const startPos = gens.findIndex((g) => g.id === startGenerationId);
            if (startPos === -1) return;
            // Global index of the clicked generation's first result item.
            const startIndex = gens.slice(0, startPos).reduce((sum, g) => sum + (g.resultItems?.length ?? 0), 0);
            setViewerGens(gens);
            setViewerIndex(startIndex);
            setViewerOpen(true);
        },
        [selectedId, generations]
    );

    const closeViewer = React.useCallback(() => {
        setViewerOpen(false);
        setViewerGens([]);
        setViewerIndex(0);
    }, []);

    // Move one step through the flattened result list (wraps around at both
    // ends, matching the original single-generation behavior).
    const navigateViewer = React.useCallback(
        (delta: 1 | -1) => {
            const total = viewerEntries.length;
            if (total === 0) return;
            setViewerIndex((prev) => (prev + delta + total) % total);
        },
        [viewerEntries.length]
    );

    return {
        viewerOpen,
        viewerEntries,
        viewerCurrent,
        viewerIndex,
        viewerMediaUrl,
        openViewer,
        closeViewer,
        navigateViewer
    };
}
