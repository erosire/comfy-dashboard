// FooterActions — the dashboard's footer fragment, one row regardless of
// the active content tab:
//
//   Left  — a single OUTPUT view toggle ("List" ⇄ "Thumbs") for the
//           generations pane.
//   Right — the generation controls, now shown on EVERY tab (PROMPT /
//           JSON / OUTPUT): the primary New button (spawns a fresh pod),
//           a "#N" button per spawned pod (queue another generation on an
//           existing pod, skipping pod creation), then the "Auto" load
//           balancer at the very end (queues onto the least-loaded ready
//           pod; visible only while such a pod exists).
//
// Pod buttons appear the moment New is clicked (loading border ring
// while the pod_url resolves). Never disabled while running — pods accept
// concurrent jobs; the two-digit label suffix counts the queued jobs
// (A03 = pod A with 3 in flight). They carry their own status: circular
// loading border while spawning / while jobs are in flight, colored border
// for the last settled result, heartbeat removal when the pod_url dies.

import React from 'react';
import { theme } from '../../../styles';
import { Btn, BtnPrimary } from './ui';
import {
    MAX_POD_FAILURES,
    POD_RING_TRACK,
    pickLeastLoadedPod,
    podButtonLabel,
    podLetter,
    type OutputViewMode,
    type PodEntry
} from './utils';

export type FooterActionsProps = {
    pods: PodEntry[];
    /** The loaded node count — New, Auto and pod buttons need a workflow. */
    nodeCount: number;
    onPodGenerate: (pod: PodEntry) => void;
    onGenerate: () => void;
    /** Queue on the least-loaded ready pod (no-op target when none ready). */
    onAutoGenerate: () => void;
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
    outputView,
    onOutputViewChange
}) => {
    const autoTarget = pickLeastLoadedPod(pods);
    return (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            {/* Left: the single OUTPUT view toggle — one button that flips
                between list rows and the thumbnail grid (it shows the
                CURRENT mode). */}
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

            <div style={{ flex: '1 1 auto' }} />

            {/* Right: New, the pod buttons, then Auto — generation controls
                are available on every tab. New spawns a fresh cloud pod,
                snapshots the workflow, and streams the run back via POST
                /v1/comfy/cloud/prompt. Never blocked — every click spawns
                another pod. Wrapped in an arrow — the handler's optional
                first param is a rerun prompt override, NOT the click
                event. */}
            <BtnPrimary
                className="sg-primary"
                onClick={() => onGenerate()}
                disabled={nodeCount === 0}
                title={nodeCount === 0 ? 'Load a workflow first' : 'Spawn a new cloud pod and generate'}
            >
                New
            </BtnPrimary>

            {/* A00: queue another generation on an existing pod (skips pod
                creation). Sits immediately right of New. */}
            {pods.map((p) => {
                const isSpawning = p.status === 'spawning';
                const inFlight = p.activeGenerationIds.length;
                const isLoading = isSpawning || inFlight > 0;
                const letter = podLetter(p.podNumber);
                const isDisabled = isSpawning || nodeCount === 0 || !p.pod_url || p.status !== 'ready';
                return (
                    <Btn
                        key={p.id}
                        className={isLoading ? 'sg-hover sg-ring-loading' : 'sg-hover'}
                        onClick={() => onPodGenerate(p)}
                        disabled={isDisabled}
                        title={
                            isSpawning
                                ? `Pod ${letter} — starting up…`
                                : p.status !== 'ready'
                                  ? `Pod ${letter} — ${p.error || 'unavailable'} ` +
                                    `(heartbeat ${p.failCount}/${MAX_POD_FAILURES}, removed if it keeps failing)`
                                  : inFlight > 0
                                    ? `Pod ${letter} — ${inFlight} job${inFlight !== 1 ? 's' : ''} ` +
                                      `in flight on ${p.pod_url} — click to queue another`
                                    : `Queue a new generation on ${p.pod_url}`
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
                        data-testid={`pod-generate-${p.podNumber}`}
                    >
                        {podButtonLabel(p.podNumber, inFlight)}
                    </Btn>
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
