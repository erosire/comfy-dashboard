// FooterActions — the dashboard's footer fragment, one row regardless of
// the active content tab:
//
//   Left  — a single OUTPUT view toggle ("List" ⇄ "Thumbs") for the
//           generations pane.
//   Right — the generation controls, now shown on EVERY tab (PROMPT /
//           JSON / OUTPUT): the primary New button (opens the GPU picker
//           dialog — the picked GPU spawns a fresh pod), one GPU-labeled
//           button per spawned pod (queue another generation on an
//           existing pod, skipping pod creation), then the "Auto" load
//           balancer at the very end (queues onto the least-loaded ready
//           pod; visible only while such a pod exists). Example row:
//           [+][4090][4090 + badge 3][B300 + badge 1][Auto].
//
// Pod buttons appear the moment a GPU is picked (loading border ring
// while the pod_url resolves), labeled with the GPU name plus the queued
// job count badge while busy ("3" = three jobs in flight). Every button
// represents a native ComfyUI websocket connection and carries its own
// status: circular loading while spawning / while jobs are in flight,
// colored border for the last settled result, and heartbeat removal when
// the pod_url dies.

import React from 'react';
import { theme } from '../../../styles';
import { Btn, BtnPrimary, PodButton, PodQueueBadge } from './ui';
import {
    MAX_POD_FAILURES,
    POD_RING_TRACK,
    pickLeastLoadedPod,
    podButtonLabel,
    podButtonQueueBadge,
    podLetter,
    type EditorContentTab,
    type OutputViewMode,
    type PodEntry
} from './utils';

export type FooterActionsProps = {
    pods: PodEntry[];
    /** The loaded node count — New, Auto and pod buttons need a workflow. */
    nodeCount: number;
    onPodGenerate: (pod: PodEntry) => void;
    /** Open the GPU picker (GpuSelectDialog) — the picked GPU spawns a pod. */
    onGenerate: () => void;
    /** Queue on the least-loaded ready pod (no-op target when none ready). */
    onAutoGenerate: () => void;
    /** Active content tab controls whether the OUTPUT-only view toggle renders. */
    contentTab: EditorContentTab;
    /** OUTPUT-tab presentation mode (list vs thumbnail grid). */
    outputView: OutputViewMode;
    onOutputViewChange: (view: OutputViewMode) => void;
};

export const FooterActions: React.FC<FooterActionsProps> = ({
    pods,
    nodeCount,
    onPodGenerate,
    onGenerate,
    onAutoGenerate,
    contentTab,
    outputView,
    onOutputViewChange
}) => {
    const autoTarget = pickLeastLoadedPod(pods);
    return (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            {/* The list/thumbnail control belongs only to the OUTPUT page;
                PROMPT and JSON use the footer space exclusively for generation actions. */}
            {contentTab === 'results' && (
                <Btn
                    className="sg-hover"
                    onClick={() => onOutputViewChange(outputView === 'list' ? 'thumbs' : 'list')}
                    title={outputView === 'list' ? 'Switch to thumbnail grid view' : 'Switch to list view'}
                    data-testid="output-view-toggle"
                    style={{
                        padding: '3px 10px',
                        fontSize: theme.fontSize.xs,
                        fontWeight: 600
                    }}
                >
                    {outputView === 'list' ? 'List' : 'Thumbs'}
                </Btn>
            )}

            <div style={{ flex: '1 1 auto' }} />

            {/* Right: New, the pod buttons, then Auto — generation controls
                are available on every tab. New opens the GPU picker dialog
                (GpuSelectDialog); the picked GPU spawns a fresh cloud pod,
                snapshots the workflow, and streams the run back via POST
                /v1/comfy/cloud/prompt. Never blocked — every pick spawns
                another pod. Wrapped in an arrow — the handler takes NO
                argument (the click event is not a rerun prompt override). */}
            <BtnPrimary
                className="sg-primary"
                onClick={() => onGenerate()}
                disabled={nodeCount === 0}
                title={nodeCount === 0 ? 'Load a workflow first' : 'Spawn a new cloud pod and generate'}
            >
                +
            </BtnPrimary>

            {/* 4090 / B300 with a numeric queue badge: queue another generation
                on an existing native ComfyUI websocket. */}
            {pods.map((p) => {
                const isSpawning = p.status === 'spawning';
                const inFlight = p.activeGenerationIds.length;
                const isLoading = isSpawning || inFlight > 0;
                const letter = podLetter(p.podNumber);
                const isDisabled = isSpawning || nodeCount === 0 || !p.pod_url || p.status !== 'ready';
                // Keep the settled run state and active queue state visible in
                // the styled button while leaving the badge to show only N.
                const borderColor = isLoading
                    ? POD_RING_TRACK
                    : p.run.status === 'error'
                      ? theme.dangerBorder
                      : p.run.status === 'done'
                        ? theme.success
                        : theme.border;
                return (
                    <PodButton
                        key={p.id}
                        className={isLoading ? 'sg-hover sg-ring-loading' : 'sg-hover'}
                        onClick={() => onPodGenerate(p)}
                        disabled={isDisabled}
                        title={
                            isSpawning
                                ? `Pod ${letter}${p.gpu ? ` (${p.gpu})` : ''} — starting up…`
                                : p.status !== 'ready'
                                  ? `Pod ${letter} — ${p.error || 'unavailable'} ` +
                                    `(heartbeat ${p.failCount}/${MAX_POD_FAILURES}, removed if it keeps failing)`
                                  : inFlight > 0
                                    ? `Pod ${letter} (ComfyUI websocket) — ${inFlight} job${inFlight !== 1 ? 's' : ''} ` +
                                      `in flight on ${p.pod_url} — click to queue another`
                                  : `Queue a new generation on ${p.pod_url} over the ComfyUI websocket`
                        }
                        borderStyle="solid"
                        borderColor={borderColor}
                        data-testid={`pod-generate-${p.podNumber}`}
                        data-transport="websocket"
                    >
                        {podButtonLabel(p, inFlight)}
                        {podButtonQueueBadge(p, inFlight) && (
                            <PodQueueBadge data-testid={`pod-queue-badge-${p.podNumber}`}>
                                {podButtonQueueBadge(p, inFlight)}
                            </PodQueueBadge>
                        )}
                    </PodButton>
                );
            })}

            {/* AUTO: the load balancer — queues the next generation on the
                ready pod with the smallest in-flight queue (A02 → A03 when
                A is the least loaded). Renders only while such a pod
                exists; with no pods there's nothing to balance.
                Wrapped in an arrow — the handler's optional first param is
                a rerun prompt override, NOT the click event. */}
            {autoTarget && (
                <Btn
                    className="sg-hover"
                    onClick={() => onAutoGenerate()}
                    disabled={nodeCount === 0}
                    title={
                        nodeCount === 0
                            ? 'Load a workflow first'
                            : `Queue on Pod ${podLetter(autoTarget.podNumber)} — the least-loaded pod ` +
                              `(${autoTarget.activeGenerationIds.length} job${autoTarget.activeGenerationIds.length !== 1 ? 's' : ''} in flight)`
                    }
                    data-testid="auto-generate"
                >
                    Auto
                </Btn>
            )}
        </div>
    );
};
