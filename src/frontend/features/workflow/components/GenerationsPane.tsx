// GenerationsPane — the OUTPUT tab: the workflow's generations list.
// Clicking an item with results opens the full-screen result viewer.
//
// Two presentation modes (toggled from the footer while on this tab):
//
//   LIST  — one SINGLE row per generation: [ ||| | id (time) | ✕ ] — menu
//           grip, divider, id+time, divider, delete.
//   THUMBS — a masonry grid (4 columns, 2 on mobile) with one card per
//           generation: the first result item's media streams straight
//           from the server (no base64 payloads through React), with an
//           overlay bar on top of the image (colored label on the left,
//           ✕ delete at the top-right corner).
//
// Shared conventions:
//   - The id text carries the status purely by color (green = completed
//     with output, red = failed OR completed but produced no items,
//     grey = pending/processing), with the generation time in brackets
//     next to the id when known.
//   - Every generation WITH results carries a media-kind badge (VIDEO /
//     AUDIO / IMAGE) next to the id — the dominant kind of its result
//     items by priority video > audio > image, so a mixed run (a graph
//     emitting an image AND its video interpolation, say) is marked by
//     the highest kind. Runs with no output yet show no badge.
//   - Click behavior: a generation WITH results opens the full-screen
//     result viewer; a FAILED/ERRORED generation (red — including a
//     "completed" run that produced no output) opens its .log event trail
//     in a read-only dialog with a Copy button, for debugging. A failed
//     run that still captured partial results opens the log too — the
//     terminal error is the thing worth seeing.
//   - The ||| grip on the left of a LIST row is a PLACEHOLDER for a
//     per-generation actions menu: clickable (sg-hover affordance) but
//     performs no action for now.
//   - The ✕ delete button asks for confirmation (handled by the caller).
// No relative timestamps, no status badges, no result counts (almost
// every generation is 1 item) — the tooltip keeps a glanceable hint (the
// error's first text plus the click affordance); the full trail lives in
// the log dialog.
//
// The editor area scrolls, so no height cap is needed here.
//
// Extracted verbatim from the original CloudTab.tsx OUTPUT tab body.

import React from 'react';
import styled from '@emotion/styled';
import { theme } from '../../../styles';
import type { GenerationSummary } from '../../../api';
import type { MediaKind, OutputViewMode } from './utils';
import { generationMediaKind } from './utils';
import { EmptyHint } from './ui';

// ── List view ─────────────────────────────────────────────────────────

// Taller row — the extra vertical padding gives the ||| grip and the ✕
// room to breathe, and alignItems: center keeps all three segments
// vertically centered.
const QueueItemEl = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    padding: '10px 10px',
    minHeight: 38,
    boxSizing: 'border-box' as const,
    borderRadius: theme.radiusMd,
    border: `1px solid ${theme.border}`,
    marginBottom: 4,
    backgroundColor: theme.surface2
});

// GenMenuGrip — the ||| menu button at the left of a generation row.
// PLACEHOLDER: the per-generation actions menu will hang off this button
// later; for now it is clickable but performs no action. It carries the
// shared sg-hover hook so it reads as interactive. The three bars are
// CSS-drawn so they stay crisp at any UI scale — no font glyph to
// misalign.
const GenMenuGrip = styled('button')({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    padding: 0,
    border: `1px solid transparent`,
    borderRadius: theme.radiusSm,
    backgroundColor: 'transparent',
    color: theme.textFaint,
    cursor: 'pointer',
    flex: '0 0 auto',
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`
});

const GenMenuBars = styled('span')({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    // Fixed inner height so the bars sit centered mid-row regardless of
    // the surrounding line-height.
    height: 14
});

const GenMenuBar = styled('span')({
    width: 3,
    height: '100%',
    borderRadius: 1,
    backgroundColor: 'currentColor'
});

// GenDivider — thin vertical divider separating the row's segments
// (grip | id | ✕). alignSelf: stretch fills the row's full content height.
const GenDivider = styled('span')({
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: theme.border,
    flex: '0 0 auto'
});

const QueueItemName = styled('div')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: '1 1 auto',
    minWidth: 0
});

// GenDeleteBtn — compact ✕ at the far right of a generation's row.
// Ghost styling (faint, borderless) until hovered, when the global
// .sg-danger class paints it like every other destructive control.
const GenDeleteBtn = styled('button')({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    padding: 0,
    border: `1px solid transparent`,
    borderRadius: theme.radiusSm,
    backgroundColor: 'transparent',
    color: theme.textFaint,
    cursor: 'pointer',
    fontSize: theme.fontSize.sm,
    lineHeight: 1,
    flex: '0 0 auto',
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`
});

// ── Thumbnail (masonry) view ──────────────────────────────────────────

// ThumbGrid — CSS-column masonry: items keep their natural aspect ratio
// and pack top-to-bottom, left-to-right across `cols` columns.
const ThumbGrid = styled('div', {
    shouldForwardProp: (prop) => prop !== 'cols'
})<{ cols: number }>(({ cols }) => ({
    columnCount: cols,
    columnGap: 8
}));

const ThumbCard = styled('div')({
    // relative — the overlay label/delete bar is positioned over the media.
    position: 'relative',
    breakInside: 'avoid',
    marginBottom: 8,
    borderRadius: theme.radiusMd,
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface2,
    overflow: 'hidden',
    transition: `border-color ${theme.transition}`
});

const ThumbMedia = styled('div')({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 72,
    backgroundColor: theme.surface3,
    color: theme.textFaint,
    fontSize: theme.fontSize.xs
});

// ThumbOverlay — the card's top bar, laid over the media itself: label on
// the left, ✕ delete at the top-right corner. The dark top-down gradient
// keeps the text and button readable over any image while fading out
// before it covers much of the media. It's part of the card, so clicks on
// the bar bubble up to the card's open-viewer handler (the ✕ button
// stops propagation).
const ThumbOverlay = styled('div')({
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    padding: '4px 6px 4px 8px',
    boxSizing: 'border-box' as const,
    background: 'linear-gradient(to bottom, rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0))'
});

const ThumbName = styled('span')({
    fontSize: theme.fontSize.xs,
    fontWeight: 600,
    color: theme.text,
    // Overlays the media — a slight shadow keeps the label readable where
    // the overlay gradient has already faded out.
    textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: '1 1 auto',
    minWidth: 0
});

// ── Media-kind badge ──────────────────────────────────────────────────

// KindBadge — the generation's dominant media kind (see
// generationMediaKind: video > audio > image) as a small uppercase chip,
// colored per kind so the OUTPUT list reads at a glance. The soft-tint +
// colored-border recipe mirrors the theme's semantic treatments
// (danger/dangerSoft/dangerBorder); translucent fills stay readable both
// on a list row and over thumb media.
const MEDIA_KIND_STYLE: Record<MediaKind, { color: string; bg: string; border: string }> = {
    video: { color: theme.accent, bg: theme.accentSoft, border: theme.accentRing },
    audio: { color: theme.warning, bg: theme.warningSoft, border: 'rgba(251, 191, 36, 0.35)' },
    image: { color: theme.success, bg: theme.successSoft, border: 'rgba(110, 231, 183, 0.35)' }
};

const KindBadge = styled('span', {
    shouldForwardProp: (prop) => prop !== 'kind'
})<{ kind: MediaKind }>(({ kind }) => ({
    flex: '0 0 auto',
    fontSize: theme.fontSize.xs,
    fontWeight: 700,
    lineHeight: 1,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    padding: '3px 5px',
    borderRadius: theme.radiusSm,
    color: MEDIA_KIND_STYLE[kind].color,
    backgroundColor: MEDIA_KIND_STYLE[kind].bg,
    border: `1px solid ${MEDIA_KIND_STYLE[kind].border}`
}));

// GenKindBadge — the badge as rendered against a generation: null kind
// (no results) renders nothing.
const GenKindBadge: React.FC<{ kind: MediaKind | null; genId: string }> = ({ kind, genId }) =>
    kind ? (
        <KindBadge kind={kind} title={`${kind} output`} data-testid={`gen-kind-${genId}`}>
            {kind}
        </KindBadge>
    ) : null;

const MEDIA_STYLE: React.CSSProperties = { display: 'block', width: '100%' };

export type GenerationsPaneProps = {
    generations: GenerationSummary[];
    /** Opens the result viewer positioned at the generation's first result. */
    onOpenViewer: (generationId: string) => void;
    /** Opens the generation's .log event trail dialog (failed/error runs). */
    onShowLog: (generationId: string) => void;
    /** Asks to delete a generation (the caller confirms first — destructive). */
    onDeleteGeneration: (generationId: string) => void;
    /** Presentation mode — compact list rows or the thumbnail grid. */
    view: OutputViewMode;
    /** Narrow screens drop the masonry grid to 2 columns. */
    isMobile: boolean;
    /** Builds the streaming URL for a result item's raw bytes. */
    getResultMediaUrl: (generationId: string, resultIndex: number) => string;
};

export const GenerationsPane: React.FC<GenerationsPaneProps> = ({
    generations,
    onOpenViewer,
    onShowLog,
    onDeleteGeneration,
    view,
    isMobile,
    getResultMediaUrl
}) => {
    if (generations.length === 0) {
        return (
            <div data-testid="results-tab-pane">
                <EmptyHint>No generations yet.</EmptyHint>
            </div>
        );
    }

    if (view === 'thumbs') {
        return (
            <div data-testid="results-tab-pane">
                <ThumbGrid cols={isMobile ? 2 : 4} data-testid="results-thumb-grid">
                    {generations.map((gen) => {
                        const first = gen.resultItems?.[0];
                        const hasResults = !!first;
                        const noOutput = gen.status === 'completed' && !hasResults;
                        const failed = gen.status === 'failed' || noOutput;
                        const mediaKind = generationMediaKind(gen);
                        const statusColor = failed ? theme.danger : gen.status === 'completed' ? theme.success : theme.textDim;
                        // Failed/error generations open the .log dialog;
                        // successful ones with results open the viewer.
                        // (A failed run with partial results opens the log
                        // — the terminal error is what needs debugging.)
                        const tooltip = failed
                            ? `${gen.error ?? 'Completed with no output — treated as failed'} — click to view the log`
                            : gen.id;
                        return (
                            <ThumbCard
                                key={gen.id}
                                data-testid={`gen-thumb-${gen.id}`}
                                style={hasResults || failed ? { cursor: 'pointer' } : undefined}
                                onClick={failed ? () => onShowLog(gen.id) : hasResults ? () => onOpenViewer(gen.id) : undefined}
                            >
                                {first ? (
                                    first.type === 'video' ? (
                                        // First frame as the poster — preload
                                        // metadata only, never autoplay.
                                        <video src={getResultMediaUrl(gen.id, 0)} muted playsInline preload="metadata" style={MEDIA_STYLE} />
                                    ) : first.type === 'audio' ? (
                                        // Inline player; stop propagation so
                                        // its controls don't open the viewer.
                                        <audio
                                            src={getResultMediaUrl(gen.id, 0)}
                                            controls
                                            preload="metadata"
                                            style={MEDIA_STYLE}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    ) : (
                                        <img src={getResultMediaUrl(gen.id, 0)} alt={gen.id} loading="lazy" style={MEDIA_STYLE} />
                                    )
                                ) : (
                                    <ThumbMedia>
                                        {gen.status === 'processing' || gen.status === 'pending' ? 'running…' : 'no output'}
                                    </ThumbMedia>
                                )}
                                <ThumbOverlay>
                                    <ThumbName title={tooltip} style={{ color: statusColor }}>
                                        {gen.id}
                                        {gen.generatedTime && (
                                            <span style={{ color: theme.textFaint, fontWeight: 400 }}> ({gen.generatedTime})</span>
                                        )}
                                    </ThumbName>
                                    <GenKindBadge kind={mediaKind} genId={gen.id} />
                                    <GenDeleteBtn
                                        className="sg-danger"
                                        title="Delete this generation"
                                        data-testid={`gen-delete-${gen.id}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteGeneration(gen.id);
                                        }}
                                    >
                                        ✕
                                    </GenDeleteBtn>
                                </ThumbOverlay>
                            </ThumbCard>
                        );
                    })}
                </ThumbGrid>
            </div>
        );
    }

    return (
        <div data-testid="results-tab-pane">
            {generations.map((gen) => {
                const hasResults = (gen.resultItems?.length ?? 0) > 0;
                // A run the server marks completed but that produced NO output
                // items (image/video) is de facto failed — the pod finished
                // cleanly yet the graph emitted nothing (bypassed node, bad
                // output config, ...). Show it red, with the reason in the
                // tooltip since there's no status text anymore.
                const noOutput = gen.status === 'completed' && !hasResults;
                const failed = gen.status === 'failed' || noOutput;
                const mediaKind = generationMediaKind(gen);
                // Status by color alone: green = completed (with output),
                // red = failed or output-less "completion", grey =
                // pending/processing.
                const statusColor = failed ? theme.danger : gen.status === 'completed' ? theme.success : theme.textDim;
                // Click target: failed/error → the .log dialog (debugging);
                // completed with results → the result viewer.
                const tooltip = failed
                    ? `${gen.error ?? 'Completed with no output — treated as failed'} — click to view the log`
                    : gen.id;
                return (
                    <QueueItemEl
                        key={gen.id}
                        data-testid={`gen-item-${gen.id}`}
                        style={
                            hasResults || failed
                                ? {
                                      cursor: 'pointer',
                                      transition: `border-color ${theme.transition}`
                                  }
                                : undefined
                        }
                        onClick={failed ? () => onShowLog(gen.id) : hasResults ? () => onOpenViewer(gen.id) : undefined}
                    >
                        {/* Menu grip — placeholder for the per-generation
                            actions menu (added later): clickable, but performs
                            no action yet. The stopPropagation keeps its click
                            from falling through to the row's open-viewer
                            handler. */}
                        <GenMenuGrip
                            type="button"
                            className="sg-hover"
                            aria-label={`Generation ${gen.id} menu`}
                            title="Menu (coming soon)"
                            data-testid={`gen-menu-${gen.id}`}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <GenMenuBars aria-hidden>
                                <GenMenuBar />
                                <GenMenuBar />
                                <GenMenuBar />
                            </GenMenuBars>
                        </GenMenuGrip>
                        <GenDivider />
                        <QueueItemName title={tooltip} style={{ color: statusColor }}>
                            {gen.id}
                            {gen.generatedTime && (
                                <span style={{ color: theme.textFaint, fontWeight: 400 }}>
                                    {' '}
                                    ({gen.generatedTime})
                                </span>
                            )}
                        </QueueItemName>
                        <GenKindBadge kind={mediaKind} genId={gen.id} />
                        <GenDivider />
                        {/* Delete — stopPropagation so the click doesn't fall
                            through to the row's open-viewer handler. */}
                        <GenDeleteBtn
                            className="sg-danger"
                            title="Delete this generation"
                            data-testid={`gen-delete-${gen.id}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                onDeleteGeneration(gen.id);
                            }}
                        >
                            ✕
                        </GenDeleteBtn>
                    </QueueItemEl>
                );
            })}
        </div>
    );
};
