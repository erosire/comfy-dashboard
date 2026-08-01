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
//   - Workflow dropdown (top-left): picks WHERE the viewed image is fed
//     by Fork Workflow / the rerun buttons — "Default" uses the viewed
//     image's own prompt; every other entry is a saved workflow that
//     declares Inputs — the viewed image's base64 data stream is written
//     into an in-memory copy of that workflow's marked Input fields
//     (Data URI / Universal Data Input widgets). Selection only; the
//     target workflow is never modified.
//   - "Fork Workflow" (right of the dropdown): saves a new workflow —
//     with "Default", a verbatim copy of the viewed image's snapshotted
//     prompt; with an Input workflow selected, a copy of THAT workflow
//     with the viewed image fed into its Input fields.
//   - New + "#N" pod buttons + Auto (bottom bar): rerun — New spawns a
//     fresh pod, each pod button queues the job on an existing pod, Auto
//     (right end, visible only while a pod is ready) queues it on the
//     least-loaded ready pod. They mirror the footer's generation
//     controls; with a dropdown target armed they run the fed copy
//     instead of the viewed image's own prompt, and the generation saves
//     on the workflow being viewed.
//
// Extracted from the original CloudTab.tsx viewer modal.

import React from 'react';
import { theme } from '../../../styles';
import { Btn, BtnPrimary } from './ui';
import {
    MAX_POD_FAILURES,
    POD_RING_TRACK,
    VIEWER_SWIPE_THRESHOLD_PX,
    pickLeastLoadedPod,
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
    /** Rerun the viewed image's prompt on the least-loaded ready pod. */
    onAutoGenerate?: () => void;
    /**
     * Fork the viewed image's prompt into a new workflow — with "Default"
     * a verbatim copy of its prompt; with an Input workflow selected, a
     * copy of that workflow with the viewed image fed into its Inputs.
     */
    onForkWorkflow?: () => void;
    /**
     * Saved workflows that declare Input markings (meta.inputFields
     * non-empty) — the preview dropdown lists them next to "Default".
     */
    inputTargets?: { id: string; name: string }[];
    /**
     * Currently selected dropdown target — null means "Default" (rerun
     * the viewed image's own prompt). Selection only; nothing fires
     * until a rerun button is pressed.
     */
    inputTargetId?: string | null;
    /** Change the dropdown selection. */
    onInputTargetChange?: (workflowId: string | null) => void;
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
    onAutoGenerate,
    onForkWorkflow,
    inputTargets = [],
    inputTargetId = null,
    onInputTargetChange,
    actionBusy = false
}) => {
    const rootRef = React.useRef<HTMLDivElement>(null);
    // Touch-start point for swipe navigation (null while no gesture is live).
    const touchRef = React.useRef<{ x: number; y: number } | null>(null);
    // The pod Auto would queue on — mirrors the footer's load balancer.
    const autoTarget = pickLeastLoadedPod(pods);
    // Only images can feed workflow Inputs (the base64 data stream).
    const canFeedInputs = current?.type === 'image';
    // Name of the selected Input workflow — arming context for the rerun
    // buttons' tooltips (null while "Default" is selected).
    const inputTargetName = inputTargetId
        ? (inputTargets.find((t) => t.id === inputTargetId)?.name ?? null)
        : null;

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
                // Don't hijack gestures on the media player controls.
                if (e.target instanceof HTMLVideoElement || e.target instanceof HTMLAudioElement) {
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
                ) : mediaUrl && current?.type === 'audio' ? (
                    <audio
                        // Remount per item so the new media loads cleanly.
                        key={`${current.generationId}:${current.resultIndex}`}
                        src={mediaUrl}
                        controls
                        autoPlay
                        style={{
                            width: isMobile ? '90vw' : 480
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

            {/* Top-left action cluster — the preview workflow dropdown
                ("Default" uses the viewed image's own prompt; a workflow
                with Inputs arms feeding the viewed image's base64 stream
                into an in-memory copy of that workflow — the target is
                never modified), then "Fork Workflow" at its right: with
                "Default" it saves a verbatim copy of the image's prompt;
                with a target selected it saves a copy of THAT workflow
                with the image fed into its Input fields. */}
            {((inputTargets.length > 0 && onInputTargetChange) || onForkWorkflow) && (
                <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'absolute',
                        top: 12,
                        left: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        maxWidth: 'calc(100vw - 24px)',
                        flexWrap: 'wrap',
                        zIndex: 1
                    }}
                >
                    {inputTargets.length > 0 && onInputTargetChange && (
                        <select
                            value={inputTargetId ?? 'default'}
                            onChange={(e) => {
                                const workflowId = e.target.value;
                                onInputTargetChange(workflowId === 'default' ? null : workflowId);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            disabled={actionBusy}
                            title={
                                canFeedInputs
                                    ? 'Where this image is fed — Default uses the image\'s own ' +
                                      "prompt; a workflow with Inputs uses an in-memory copy of it with this image's " +
                                      'base64 stream fed into its marked Data URI (Universal Data Input) fields'
                                    : 'Only image results can feed workflow Inputs (the selection is kept until you run on an image)'
                            }
                            data-testid="viewer-input-workflow"
                            style={{
                                padding: '6px 10px',
                                borderRadius: theme.radiusMd,
                                border: '1px solid rgba(255,255,255,0.3)',
                                backgroundColor: 'rgba(0,0,0,0.55)',
                                color: '#fff',
                                fontSize: theme.fontSize.sm,
                                fontWeight: 600,
                                cursor: actionBusy ? 'not-allowed' : 'pointer',
                                opacity: actionBusy ? 0.55 : 1,
                                maxWidth: '45vw'
                            }}
                        >
                            <option value="default" style={{ backgroundColor: '#111' }}>
                                Default
                            </option>
                            {inputTargets.map((target) => (
                                <option key={target.id} value={target.id} style={{ backgroundColor: '#111' }}>
                                    {target.name}
                                </option>
                            ))}
                        </select>
                    )}
                    {onForkWorkflow && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onForkWorkflow();
                            }}
                            disabled={actionBusy}
                            title={
                                inputTargetName
                                    ? `Save a copy of "${inputTargetName}" with this image fed into its ` +
                                      'Input fields as a new workflow'
                                    : "Save a copy of this image's prompt as a new workflow"
                            }
                            data-testid="viewer-fork-workflow"
                            style={{
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
                                gap: 6
                            }}
                        >
                            Fork Workflow
                        </button>
                    )}
                </div>
            )}

            {/* Rerun controls — bottom bar: New (spawns a fresh pod), one
                "#N" button per spawned pod to New's right (queues the
                viewed image's prompt on that pod), then Auto at the right
                end (queues it on the least-loaded ready pod; visible only
                while such a pod exists). Mirrors the footer's New/pod/Auto
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
                    <BtnPrimary
                        className="sg-primary"
                        onClick={onGenerate}
                        disabled={actionBusy}
                        title={
                            inputTargetName
                                ? `Spawn a new cloud pod — feeds this image into "${inputTargetName}"'s ` +
                                  'Inputs and runs that copy (the generation saves on this workflow)'
                                : "Spawn a new cloud pod and regenerate with this image's prompt"
                        }
                        data-testid="viewer-generate"
                    >
                        New
                    </BtnPrimary>
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
                                              `in flight on ${p.pod_url} — click to queue ` +
                                              (inputTargetName
                                                  ? `the fed run ("${inputTargetName}")`
                                                  : "this image's prompt")
                                            : inputTargetName
                                              ? `Feed this image into "${inputTargetName}"'s Inputs — ` +
                                                `queue the run on ${p.pod_url} (the generation saves on this workflow)`
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
                    {/* Auto — same load balancer as the footer, rendered
                        only while a ready pod exists to take the job. */}
                    {onAutoGenerate && autoTarget && (
                        <Btn
                            className="sg-hover"
                            onClick={onAutoGenerate}
                            disabled={actionBusy}
                            title={
                                inputTargetName
                                    ? `Feed this image into "${inputTargetName}"'s Inputs — queue the run on ` +
                                      `Pod ${podLetter(autoTarget.podNumber)}, the least-loaded pod ` +
                                      `(${autoTarget.activeGenerationIds.length} job${autoTarget.activeGenerationIds.length !== 1 ? 's' : ''} in flight; ` +
                                      'the generation saves on this workflow)'
                                    : `Queue this image's prompt on Pod ${podLetter(autoTarget.podNumber)} — ` +
                                      `the least-loaded pod (${autoTarget.activeGenerationIds.length} job${autoTarget.activeGenerationIds.length !== 1 ? 's' : ''} in flight)`
                            }
                            data-testid="viewer-auto-generate"
                        >
                            Auto
                        </Btn>
                    )}
                </div>
            )}
        </div>
    );
};
