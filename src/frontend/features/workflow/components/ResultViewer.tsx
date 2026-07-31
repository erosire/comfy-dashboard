// ResultViewer — full-screen image/video modal for generation results.
//
// Keyboard: ESC closes, ←/↑ previous, →/↓ next. Touch: vertical swipes
// (up = next, down = prev) are the primary mobile gesture; horizontal ones
// mirror the on-screen ‹ › arrows. Fully opaque on mobile — the media goes
// edge to edge.
//
// Focus is grabbed once on mount (the parent renders this component only
// while the viewer is open) so keyboard navigation works immediately — an
// effect, not a ref callback, so later re-renders don't re-steal focus
// from the ‹ › buttons after clicking them.
//
// Viewer actions (optional, dashboard-wired):
//   - "Create Workflow" (top-left): turns the viewed image's snapshotted
//     prompt into a new workflow.
//   - Generate + "#N" pod buttons (bottom bar): rerun the viewed image's
//     prompt — Generate spawns a fresh pod, each pod button queues the
//     job on an existing pod. They mirror the footer's generation
//     controls but feed on the generation's stored prompt instead of
//     the live editor tree.
//
// Extracted from the original CloudTab.tsx viewer modal.

import React from 'react';
import { theme } from '../../../styles';
import { Btn, BtnPrimary } from './ui';
import {
    MAX_POD_FAILURES,
    POD_RING_TRACK,
    VIEWER_SWIPE_THRESHOLD_PX,
    podButtonLabel,
    podLetter,
    type PodEntry,
    type ViewerEntry
} from './utils';

export type ResultViewerProps = {
    isMobile: boolean;
    /** Total number of viewable entries (arrows render only when > 1). */
    entriesCount: number;
    /** The currently displayed entry. */
    current?: ViewerEntry;
    /** Zero-based flattened index — used for the image alt text. */
    currentIndex: number;
    /** Streaming URL for the current entry's bytes. */
    mediaUrl: string | null;
    onClose: () => void;
    onNavigate: (delta: 1 | -1) => void;
    /** Spawned cloud pods — each renders as a "#N" rerun button. */
    pods?: PodEntry[];
    /** Rerun the viewed image's prompt on a freshly spawned pod. */
    onGenerate?: () => void;
    /** Rerun the viewed image's prompt on an existing pod. */
    onPodGenerate?: (pod: PodEntry) => void;
    /** Create a workflow from the viewed image's prompt. */
    onCreateWorkflow?: () => void;
    /** True while an action resolves (disables the action buttons). */
    actionBusy?: boolean;
};

export const ResultViewer: React.FC<ResultViewerProps> = ({
    isMobile,
    entriesCount,
    current,
    currentIndex,
    mediaUrl,
    onClose,
    onNavigate,
    pods = [],
    onGenerate,
    onPodGenerate,
    onCreateWorkflow,
    actionBusy = false
}) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    // Touch-start point for swipe navigation (null while no gesture is live).
    const touchRef = React.useRef<{ x: number; y: number } | null>(null);

    // Focus the modal when it opens so keyboard navigation works.
    React.useEffect(() => {
        rootRef.current?.focus();
    }, []);

    return (
        <div
            ref={rootRef}
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 2000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                // Fully opaque on mobile — the image goes edge to edge.
                backgroundColor: isMobile ? '#000' : 'rgba(0,0,0,0.85)',
                // Swipes are handled manually; block pull-to-refresh
                // and page scroll leaking from behind the modal.
                touchAction: 'none'
            }}
            onClick={onClose}
            onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    onNavigate(-1);
                }
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    onNavigate(1);
                }
            }}
            onTouchStart={(e) => {
                // Don't hijack gestures on the video player controls.
                if (e.target instanceof HTMLVideoElement) {
                    touchRef.current = null;
                    return;
                }
                const t = e.touches[0];
                touchRef.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={(e) => {
                const start = touchRef.current;
                touchRef.current = null;
                if (!start) return;
                const t = e.changedTouches[0];
                const dx = t.clientX - start.x;
                const dy = t.clientY - start.y;
                const absX = Math.abs(dx);
                const absY = Math.abs(dy);
                if (Math.max(absX, absY) < VIEWER_SWIPE_THRESHOLD_PX) return;
                // Vertical swipes (up = next, down = prev) are the
                // primary mobile gesture; horizontal ones mirror the
                // on-screen ‹ › arrows.
                if (absY >= absX) onNavigate(dy < 0 ? 1 : -1);
                else onNavigate(dx < 0 ? 1 : -1);
            }}
            tabIndex={0}
        >
            {/* Left arrow */}
            {entriesCount > 1 && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onNavigate(-1);
                    }}
                    style={{
                        position: 'absolute',
                        left: 20,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.3)',
                        backgroundColor: 'rgba(255,255,255,0.1)',
                        color: '#fff',
                        fontSize: 20,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 0.15s',
                        zIndex: 1
                    }}
                    title="Previous"
                >
                    ‹
                </button>
            )}

            {/* Content — edge to edge on mobile, framed on desktop */}
            <div
                onClick={(e) => e.stopPropagation()}
                style={
                    isMobile
                        ? {
                              width: '100vw',
                              height: '100dvh',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                          }
                        : {
                              maxWidth: '85vw',
                              maxHeight: '85vh',
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              gap: 12
                          }
                }
            >
                {mediaUrl && current?.type === 'image' ? (
                    <img
                        // Remount per item so the new media loads cleanly.
                        key={`${current.generationId}:${current.resultIndex}`}
                        src={mediaUrl}
                        alt={`Result ${currentIndex + 1}`}
                        draggable={false}
                        style={{
                            // objectFit contain preserves the aspect
                            // ratio; on mobile the box is the full
                            // viewport so the image is as large as it
                            // can possibly be (letterboxed as needed).
                            maxWidth: isMobile ? '100vw' : '85vw',
                            maxHeight: isMobile ? '100dvh' : '80vh',
                            objectFit: 'contain',
                            borderRadius: isMobile ? 0 : theme.radiusMd,
                            boxShadow: isMobile ? 'none' : '0 4px 24px rgba(0,0,0,0.5)'
                        }}
                    />
                ) : mediaUrl && current?.type === 'video' ? (
                    <video
                        // Remount per item so the new media loads cleanly.
                        key={`${current.generationId}:${current.resultIndex}`}
                        src={mediaUrl}
                        controls
                        autoPlay
                        style={{
                            maxWidth: isMobile ? '100vw' : '85vw',
                            maxHeight: isMobile ? '100dvh' : '80vh',
                            borderRadius: isMobile ? 0 : theme.radiusMd,
                            boxShadow: isMobile ? 'none' : '0 4px 24px rgba(0,0,0,0.5)'
                        }}
                    />
                ) : null}
            </div>

            {/* Right arrow */}
            {entriesCount > 1 && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onNavigate(1);
                    }}
                    style={{
                        position: 'absolute',
                        right: 20,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        width: 44,
                        height: 44,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.3)',
                        backgroundColor: 'rgba(255,255,255,0.1)',
                        color: '#fff',
                        fontSize: 20,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 0.15s',
                        zIndex: 1
                    }}
                    title="Next"
                >
                    ›
                </button>
            )}

            {/* Close affordance: explicit ✕ button on mobile (there's
                little tappable backdrop around an edge-to-edge image),
                keyboard hint on desktop. */}
            {isMobile ? (
                <button
                    onClick={onClose}
                    aria-label="Close"
                    style={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        border: '1px solid rgba(255,255,255,0.3)',
                        backgroundColor: 'rgba(0,0,0,0.55)',
                        color: '#fff',
                        fontSize: 18,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1
                    }}
                >
                    ✕
                </button>
            ) : (
                <div
                    style={{
                        position: 'absolute',
                        top: 20,
                        right: 20,
                        color: 'rgba(255,255,255,0.5)',
                        fontSize: theme.fontSize.xs
                    }}
                >
                    ESC to close · arrows to navigate
                </div>
            )}

            {/* Create Workflow — left side; saves the viewed image's
                snapshotted prompt as a brand-new workflow and loads it. */}
            {onCreateWorkflow && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onCreateWorkflow();
                    }}
                    disabled={actionBusy}
                    title="Create a workflow from this image's prompt"
                    data-testid="viewer-create-workflow"
                    style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        padding: '6px 14px',
                        borderRadius: theme.radiusMd,
                        border: '1px solid rgba(255,255,255,0.3)',
                        backgroundColor: 'rgba(0,0,0,0.55)',
                        color: '#fff',
                        fontSize: theme.fontSize.sm,
                        fontWeight: 600,
                        cursor: actionBusy ? 'not-allowed' : 'pointer',
                        opacity: actionBusy ? 0.55 : 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        zIndex: 1
                    }}
                >
                    ＋ Create Workflow
                </button>
            )}

            {/* Rerun controls — bottom bar: one "#N" button per spawned pod
                (queues the viewed image's prompt on that pod) plus Generate
                (spawns a fresh pod). Mirrors the footer's pod/Generate
                styling: loading ring while spawning / jobs in flight,
                settled-state border colors. */}
            {onGenerate && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'absolute',
                        bottom: 20,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        display: 'flex',
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        flexWrap: 'wrap',
                        maxWidth: '90vw',
                        padding: '8px 14px',
                        borderRadius: theme.radiusMd,
                        border: '1px solid rgba(255,255,255,0.25)',
                        backgroundColor: 'rgba(0,0,0,0.55)',
                        zIndex: 1
                    }}
                >
                    {pods.map((p) => {
                        const isSpawning = p.status === 'spawning';
                        const inFlight = p.activeGenerationIds.length;
                        const isLoading = isSpawning || inFlight > 0;
                        const letter = podLetter(p.podNumber);
                        const isDisabled =
                            actionBusy || isSpawning || !p.pod_url || p.status !== 'ready';
                        return (
                            <Btn
                                key={p.id}
                                className={isLoading ? 'sg-hover sg-ring-loading' : 'sg-hover'}
                                onClick={() => onPodGenerate?.(p)}
                                disabled={isDisabled}
                                title={
                                    isSpawning
                                        ? `Pod ${letter} — starting up…`
                                        : p.status !== 'ready'
                                          ? `Pod ${letter} — ${p.error || 'unavailable'} ` +
                                            `(heartbeat ${p.failCount}/${MAX_POD_FAILURES}, removed if it keeps failing)`
                                          : inFlight > 0
                                            ? `Pod ${letter} — ${inFlight} job${inFlight !== 1 ? 's' : ''} ` +
                                              `in flight on ${p.pod_url} — click to queue this image's prompt`
                                            : `Queue this image's prompt on ${p.pod_url}`
                                }
                                style={{
                                    fontFamily: theme.fontMono,
                                    borderColor: isLoading
                                        ? POD_RING_TRACK
                                        : p.run.status === 'error'
                                          ? theme.dangerBorder
                                          : p.run.status === 'done'
                                            ? theme.success
                                            : theme.border
                                }}
                                data-testid={`viewer-pod-generate-${p.podNumber}`}
                            >
                                {podButtonLabel(p.podNumber, inFlight)}
                            </Btn>
                        );
                    })}
                    <BtnPrimary
                        className="sg-primary"
                        onClick={onGenerate}
                        disabled={actionBusy}
                        title="Spawn a new cloud pod and regenerate with this image's prompt"
                        data-testid="viewer-generate"
                    >
                        Generate
                    </BtnPrimary>
                </div>
            )}
        </div>
    );
};
