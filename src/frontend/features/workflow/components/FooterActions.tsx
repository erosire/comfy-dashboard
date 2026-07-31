// FooterActions — the dashboard's footer fragment: a "#N" button per
// spawned pod (queue another generation on an existing pod, skipping pod
// creation) plus the primary Generate button (spawns a fresh pod).
//
// Pod buttons appear the moment Generate is clicked (loading border ring
// while the pod_url resolves). Never disabled while running — pods accept
// concurrent jobs; the two-digit label suffix counts the queued jobs
// (A03 = pod A with 3 in flight). They carry their own status: circular
// loading border while spawning / while jobs are in flight, colored border
// for the last settled result, heartbeat removal when the pod_url dies.
//
// Extracted verbatim from the original CloudTab.tsx footer fragment.

import React from 'react';
import { theme } from '../../../styles';
import { Btn, BtnPrimary } from './ui';
import { MAX_POD_FAILURES, POD_RING_TRACK, podButtonLabel, podLetter, type PodEntry } from './utils';

export type FooterActionsProps = {
    pods: PodEntry[];
    /** The loaded node count — Generate and pod buttons need a workflow. */
    nodeCount: number;
    onPodGenerate: (pod: PodEntry) => void;
    onGenerate: () => void;
};

export const FooterActions: React.FC<FooterActionsProps> = ({ pods, nodeCount, onPodGenerate, onGenerate }) => (
    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
        <div style={{ flex: '1 1 auto' }} />

        {/* A00: queue another generation on an existing pod (skips pod
            creation). Sits immediately left of Generate. */}
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

        {/* Generate: spawns a fresh cloud pod, snapshots the workflow, and
            streams the run back via POST /v1/comfy/cloud/prompt.
            Never blocked — every click spawns another pod. */}
        <BtnPrimary
            className="sg-primary"
            onClick={onGenerate}
            disabled={nodeCount === 0}
            title={nodeCount === 0 ? 'Load a workflow first' : 'Spawn a new cloud pod and generate'}
        >
            Generate
        </BtnPrimary>
    </div>
);
