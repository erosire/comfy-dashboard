// Cloud pod lifecycle — pod creation/reuse for Generate + "#N" buttons,
// run-state sync from polled generations, and the keepalive heartbeat that
// detects dead pod_urls.
//
// Extracted from the original CloudTab.tsx. Behaviour notes preserved:
//   - Generate is NEVER blocked: every click spawns a fresh pod, as fast
//     as the user can click. Per-pod status lives on the "#N" button.
//   - Pods accept concurrent jobs: each "#N" click queues another job; the
//     server scopes each submission with its own client_id.
//   - Heartbeat probes every POD_HEARTBEAT_MS keep pods warm and accrue
//     strikes; MAX_POD_FAILURES consecutive failures remove the pod.

import React from 'react';
import type { CloudPodStatusResult, GenerationEntry, GenerationSummary } from '../../../../api';
import { cloud, cloudPrompt } from '../../../../api';
import type { UINode } from '../../../../nodes/node-type';
import type { PodEntry, RunState } from './types';
import { MAX_POD_FAILURES, POD_HEARTBEAT_MS } from './constants';
import { podLetter } from './pod-utils';
import { editorTreeToApiPrompt } from './workflow-prompt';

export type UsePodsParams = {
    baseUrl: string;
    /** The live editor tree — the prompt is built from it on every run. */
    nodes: UINode[];
    /** Id of the workflow being edited (store.selectedId). */
    editingWorkflowId: string | null;
    /** Polled generations (store.generations) — settles pod run state. */
    generations: GenerationSummary[];
    generateWorkflow: (workflowId: string, prompt?: Record<string, unknown>) => Promise<GenerationEntry>;
};

export function usePods({ baseUrl, nodes, editingWorkflowId, generations, generateWorkflow }: UsePodsParams) {
    const [pods, setPods] = React.useState<PodEntry[]>([]);
    // Monotonic counter for naming generation pods ("#1", "#2", …)
    const podCounterRef = React.useRef(0);
    const podsRef = React.useRef(pods);
    podsRef.current = pods;

    // ── Sync pod buttons from polled generations ────────────────────
    // Pod processing lives on the server; polling the generation list is
    // what settles each "#N" button's state. A pod can have several
    // jobs in flight — it stays "running" until the LAST one settles,
    // then shows done (all succeeded) or error (any failed).

    React.useEffect(() => {
        setPods((prev) => {
            let changed = false;
            const next = prev.map((p): PodEntry => {
                if (p.activeGenerationIds.length === 0) return p;

                const stillActive: string[] = [];
                const settled: GenerationSummary[] = [];
                for (const genId of p.activeGenerationIds) {
                    const gen = generations.find((g) => g.id === genId);
                    if (!gen || gen.status === 'pending' || gen.status === 'processing') {
                        stillActive.push(genId);
                    } else {
                        settled.push(gen);
                    }
                }
                if (settled.length === 0) return p;
                changed = true;

                // Some jobs still running — prune the settled ones, keep spinning
                if (stillActive.length > 0) {
                    return { ...p, activeGenerationIds: stillActive };
                }
                // Last job settled — pod goes done, or error if any failed
                const failed = settled.find((g) => g.status === 'failed');
                const run: RunState = failed
                    ? { status: 'error', events: [], message: failed.error ?? 'Generation failed' }
                    : { status: 'done', events: [] };
                return { ...p, activeGenerationIds: stillActive, run };
            });
            return changed ? next : prev;
        });
    }, [generations]);

    // ── Run a generation on a cloud pod ────────────────────────────
    // Shared by "Generate" (spawns a fresh pod) and "#N" (reuses a pod).
    //
    // 1. Builds the API prompt from the CURRENT editor tree — every
    //    widget edit is included (the stored workflow json is NOT read).
    // 2. Snapshots that prompt via the workflow generation API (same
    //    place as before: POST /v1/comfy/workflows/:id/generate, with the
    //    prompt in the request body) — edited == stored == executed.
    // 3. Submits the snapshot to POST /v1/comfy/cloud/prompt with the
    //    pod_url + workflow/generation ids. The SERVER consumes the pod's
    //    NDJSON stream and updates the generation json by itself — this
    //    call returns immediately (202).
    // 4. Client-side we are done: the continuous generations polling
    //    updates the sidebar with progress, and settles the pod button's
    //    running → done/error state (see the sync effect below).

    const runGenerationOnPod = React.useCallback(
        async (podUrl: string, podId?: string) => {
            if (nodes.length === 0 || !editingWorkflowId) return;

            // Step 1+2 — build the prompt from the live editor tree and
            // snapshot it into a generation json.
            const apiPrompt = editorTreeToApiPrompt(nodes);
            const generation = await generateWorkflow(editingWorkflowId, apiPrompt);
            console.log(`[Generate] Created generation ${generation.id} — submitting to ${podUrl}`);

            try {
                // Step 3 — submit and be done. The server processes the
                // pod stream in the background from here (scoped to this
                // job via a per-submission client_id).
                await cloudPrompt(baseUrl, {
                    pod_url: podUrl,
                    prompt: generation.prompt,
                    workflow_id: editingWorkflowId,
                    generation_id: generation.id,
                    extra_data: {
                        workflow_id: editingWorkflowId,
                        generation_id: generation.id
                    }
                });
                // Accepted — add to the pod's in-flight set; polling
                // settles each entry. Pods accept concurrent jobs, so an
                // existing run does not block this one.
                if (podId) {
                    setPods((prev) =>
                        prev.map((p) =>
                            p.id === podId
                                ? {
                                      ...p,
                                      run: { status: 'running', events: [] },
                                      activeGenerationIds: [...p.activeGenerationIds, generation.id]
                                  }
                                : p
                        )
                    );
                }
            } catch (err: any) {
                const message = err.message ?? String(err);
                // Submission itself failed — only surface an error on the
                // button when nothing else is still running on this pod.
                if (podId) {
                    setPods((prev) =>
                        prev.map((p) =>
                            p.id === podId && p.activeGenerationIds.length === 0
                                ? { ...p, run: { status: 'error', events: [], message } }
                                : p
                        )
                    );
                }
                throw err;
            }
        },
        [baseUrl, nodes, editingWorkflowId, generateWorkflow]
    );

    // ── Generate workflow ──────────────────────────────────────────
    // Creates a cloud pod first, then runs a new generation snapshot on it
    // via POST /v1/comfy/cloud/prompt. The "#N" button appears
    // IMMEDIATELY on click — in "spawning" state (spinner) while the
    // pod_url is being resolved — then flips to ready. Clicking a ready
    // #N does the same thing but reuses that pod (skipping pod creation).
    //
    // Generate is NEVER blocked: every click spawns a fresh pod, as fast
    // as the user can click. Per-pod status (spawning, running, done/error)
    // lives on the individual "#N" button, not on Generate.

    const handleGenerate = React.useCallback(async () => {
        if (nodes.length === 0 || !editingWorkflowId) return;

        // Step 1 — register the pod entry immediately so the "#N"
        // button shows up while the pod_url is still being resolved.
        podCounterRef.current += 1;
        const podNumber = podCounterRef.current;
        const podEntry: PodEntry = {
            id: `gen-pod-${Date.now()}-${podNumber}`,
            podNumber,
            name: podLetter(podNumber),
            pod_url: '',
            status: 'spawning',
            failCount: 0,
            activeGenerationIds: [],
            run: { status: 'idle' }
        };
        setPods((prev) => [...prev, podEntry]);

        // Step 2 — create the cloud pod
        console.log(`[Generate] Spawning Pod#${podNumber}...`);
        let podUrl: string;
        try {
            const result = await cloud(baseUrl, { type: 'create' });
            if (!('pod_url' in result)) {
                throw new Error('Pod spawn response did not contain pod_url');
            }
            podUrl = (result as { pod_url: string }).pod_url;
        } catch (err: any) {
            // Spawn failed — no pod_url ever existed; remove the button.
            setPods((prev) => prev.filter((p) => p.id !== podEntry.id));
            alert(`Failed to spawn pod ${podLetter(podNumber)}: ${err.message ?? String(err)}`);
            return;
        }
        console.log(`[Generate] Pod#${podNumber} spawned: ${podUrl}`);

        // Step 3 — pod_url exists: the pod is now usable
        setPods((prev) =>
            prev.map((p) => (p.id === podEntry.id ? { ...p, pod_url: podUrl, status: 'ready', failCount: 0 } : p))
        );

        // Step 4 — snapshot + submit for server-side processing.
        // A failure here keeps the pod — its button shows the run error
        // and stays reusable.
        try {
            await runGenerationOnPod(podUrl, podEntry.id);
        } catch (err: any) {
            alert(`Failed to generate: ${err.message ?? String(err)}`);
        }
    }, [nodes.length, editingWorkflowId, baseUrl, runGenerationOnPod]);

    // ── Pod button (A00): same as Generate but reuses an existing pod_url ──
    // NEVER blocked while running: each click queues ANOTHER job on the
    // pod. The server scopes each submission with its own client_id and
    // filters the shared pod stream by prompt_id, so every generation
    // json only receives its own job's events.

    const handlePodGenerate = React.useCallback(
        async (pod: PodEntry) => {
            if (nodes.length === 0 || !editingWorkflowId) return;
            if (!pod.pod_url || pod.status !== 'ready') return;
            try {
                console.log(`[Pod#${pod.podNumber}] Queueing job on ${pod.pod_url}`);
                await runGenerationOnPod(pod.pod_url, pod.id);
            } catch (err: any) {
                alert(`Failed to generate: ${err.message ?? String(err)}`);
            }
        },
        [nodes.length, editingWorkflowId, runGenerationOnPod]
    );

    // ── Keepalive heartbeat ─────────────────────────────────────────
    // Pods scale to zero ~120s after the last active connection, so probing
    // periodically both resets that idle timer AND detects dead pods.
    //
    // Every probe resets the pod's strike counter on success. A failure
    // (pod unreachable, or health.healthy === false) records a strike:
    // the first strike marks the pod as error (button disabled, stays
    // visible in case it recovers); once strikes reach MAX_POD_FAILURES
    // the pod's pod_url is considered dead and the pod is removed
    // entirely — its "#N" button disappears.
    //
    // Skips the tick if the previous one is still in flight (cold start).

    // Record a failed heartbeat probe for a pod. Reads the freshest entry
    // from state so concurrent success/reset can't clobber the count.
    const strikePod = React.useCallback((podId: string, message: string) => {
        setPods((prev) => {
            const current = prev.find((ep) => ep.id === podId);
            if (!current) return prev;
            const failCount = current.failCount + 1;
            if (failCount >= MAX_POD_FAILURES) {
                console.warn(
                    `[Heartbeat] Pod#${current.podNumber} removed — pod_url stopped working ` +
                        `(${failCount} consecutive probe failures, last: ${message})`
                );
                return prev.filter((ep) => ep.id !== podId);
            }
            console.warn(
                `[Heartbeat] Pod#${current.podNumber} probe failed (${failCount}/${MAX_POD_FAILURES}): ${message}`
            );
            return prev.map((ep) => (ep.id === podId ? { ...ep, status: 'error', failCount, error: message } : ep));
        });
    }, []);

    React.useEffect(() => {
        let running = false;
        const interval = setInterval(async () => {
            if (running) return; // previous tick still in flight — skip
            running = true;
            try {
                const currentPods = podsRef.current;
                for (const p of currentPods) {
                    // Probe ready AND previously-failed pods so they can
                    // either recover or accumulate the final strike.
                    if (p.status === 'spawning' || !p.pod_url) continue;
                    try {
                        const result = await cloud(baseUrl, { type: 'status', pod_url: p.pod_url });
                        const statusResult = result as CloudPodStatusResult;
                        const healthy = 'health' in result ? statusResult.health?.healthy !== false : true;
                        if (healthy) {
                            // Alive — clear strikes, refresh health, mark ready
                            setPods((prev) =>
                                prev.map((ep) =>
                                    ep.id === p.id
                                        ? {
                                              ...ep,
                                              status: 'ready',
                                              failCount: 0,
                                              error: undefined,
                                              health: statusResult
                                          }
                                        : ep
                                )
                            );
                        } else {
                            strikePod(p.id, statusResult.health?.error ?? 'pod reported unhealthy');
                        }
                    } catch (err: any) {
                        strikePod(p.id, err.message ?? String(err));
                    }
                }
            } finally {
                running = false;
            }
        }, POD_HEARTBEAT_MS);
        return () => clearInterval(interval);
    }, [baseUrl, strikePod]);

    return { pods, handleGenerate, handlePodGenerate };
}
