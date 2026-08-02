// Cloud pod lifecycle — pod creation/reuse for the New / "#N" / Auto
// buttons, run-state sync from polled generations, and the keepalive
// heartbeat that detects dead pod_urls.
//
// Extracted from the original CloudTab.tsx. Behaviour notes preserved:
//   - New is NEVER blocked: every click spawns a fresh pod, as fast
//     as the user can click. Per-pod status lives on the "#N" button.
//   - Pods accept concurrent jobs: each "#N" click queues another job; the
//     server scopes each submission with its own client_id. "Auto" queues
//     on the least-loaded ready pod (see pickLeastLoadedPod).
//   - Heartbeat probes every POD_HEARTBEAT_MS keep pods warm and accrue
//     strikes; MAX_POD_FAILURES consecutive failures remove the pod.

import React from 'react';
import type { CloudCreateResult, CloudPodStatusResult, GenerationEntry, GenerationSummary } from '../../../../api';
import { cloud, cloudPrompt } from '../../../../api';
import type { UINode } from '../../../../nodes/node-type';
import type { PodEntry, RunState } from './types';
import { MAX_POD_FAILURES, POD_HEARTBEAT_MS } from './constants';
import { podLetter, pickLeastLoadedPod } from './pod-utils';

/**
 * Local-timestamp suffix for default generation names: YYYYMMDD-HHMMSS
 * (browser-local time — the same shape the server uses for its own
 * timestamped ids).
 */
function localTimestampFile(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        date.getFullYear().toString() +
        pad(date.getMonth() + 1) +
        pad(date.getDate()) +
        '-' +
        pad(date.getHours()) +
        pad(date.getMinutes()) +
        pad(date.getSeconds())
    );
}

export type UsePodsParams = {
    baseUrl: string;
    /** The live editor tree — guards editor-driven runs (need a workflow). */
    nodes: UINode[];
    /** Id of the workflow being edited (store.selectedId). */
    editingWorkflowId: string | null;
    /** Name of the workflow being edited — names new generations by default. */
    workflowName: string | null;
    /** Polled generations (store.generations) — settles pod run state. */
    generations: GenerationSummary[];
    /**
     * Serialize the CURRENT editor page (same snapshot Clone takes:
     * raw json + widget edits + PROMPT field selection). This ORIGINAL
     * workflow json is what gets snapshotted as the generation's stored
     * `prompt` — kept lossless; the server converts it to the flat API
     * prompt when submitting to a pod (POST /v1/comfy/cloud/prompt).
     */
    getCurrentRaw?: () => Record<string, unknown> | null;
    generateWorkflow: (workflowId: string, prompt?: Record<string, unknown>, name?: string) => Promise<GenerationEntry>;
};

/**
 * Snapshot override for the result viewer's rerun buttons: the source
 * generation's stored original workflow json — resubmitted as-is, so
 * chained reruns always carry the same lossless document. Also used by
 * the viewer's Input-feeding path: an in-memory copy of another
 * workflow's document with the viewed image fed into its Input fields
 * (the generation is still recorded under the workflow being viewed).
 */
export type GenerationSnapshot = Record<string, unknown>;

export function usePods({ baseUrl, nodes, editingWorkflowId, workflowName, generations, getCurrentRaw, generateWorkflow }: UsePodsParams) {
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
    // Shared by "New" (spawns a fresh pod), "#N" (reuses a pod), "Auto"
    // (load-balances onto the least-loaded pod) and the result viewer's
    // rerun buttons.
    //
    // 1. Takes the snapshot document: the CURRENT editor serialization
    //    (every widget edit included) by default, or a stored generation's
    //    own original workflow json for viewer reruns. Either way the
    //    ORIGINAL workflow json — lossless.
    // 2. Snapshots it via the workflow generation API (same place as
    //    before: POST /v1/comfy/workflows/:id/generate, with the document
    //    in the request body) — edited == stored == executed.
    // 3. Submits the snapshot to POST /v1/comfy/cloud/prompt with the
    //    pod_url + workflow/generation ids. THE SERVER converts the
    //    workflow json to the flat API prompt (workflowToApiPrompt),
    //    consumes the pod's NDJSON stream and updates the generation
    //    json by itself — this call returns immediately (202).
    // 4. Client-side we are done: the continuous generations polling
    //    updates the sidebar with progress, and settles the pod button's
    //    running → done/error state (see the sync effect below).

    const runGenerationOnPod = React.useCallback(
        async (podUrl: string, podId?: string, generationOverride?: GenerationSnapshot, isDirect?: boolean) => {
            const snapshot = generationOverride ?? getCurrentRaw?.() ?? null;
            if (!editingWorkflowId || !snapshot) return;

            // Step 1+2 — snapshot the original workflow json into a
            // generation file. The generation is named after the workflow +
            // current local timestamp by default (the server falls back to
            // its own timestamp id when no name is passed).
            const generationName = workflowName ? `${workflowName}_${localTimestampFile(new Date())}` : undefined;
            const generation = await generateWorkflow(editingWorkflowId, snapshot, generationName);
            console.log(`[Generate] Created generation ${generation.id} — submitting to ${podUrl}`);

            try {
                // Step 3 — submit and be done. The server processes the
                // pod stream in the background from here (scoped to this
                // job via a per-submission client_id). A direct ComfyUI pod
                // is flagged is_direct so the server drives its native
                // websocket + /prompt instead of the Tier 2 proxy. The flag
                // is handed in by the caller (creation/heartbeat are the
                // authoritative sources); fall back to the freshest pod
                // state through the ref when it wasn't.
                const directFlag =
                    isDirect ?? (podId ? podsRef.current.find((p) => p.id === podId)?.is_direct : undefined);
                await cloudPrompt(baseUrl, {
                    pod_url: podUrl,
                    prompt: generation.prompt,
                    workflow_id: editingWorkflowId,
                    generation_id: generation.id,
                    ...(directFlag !== undefined ? { is_direct: directFlag } : {}),
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
        [baseUrl, editingWorkflowId, workflowName, getCurrentRaw, generateWorkflow]
    );

    // ── New workflow ───────────────────────────────────────────────
    // Creates a cloud pod first, then runs a new generation snapshot on it
    // via POST /v1/comfy/cloud/prompt. The "#N" button appears
    // IMMEDIATELY on click — in "spawning" state (spinner) while the
    // pod_url is being resolved — then flips to ready. Clicking a ready
    // #N does the same thing but reuses that pod (skipping pod creation).
    //
    // New is NEVER blocked: every click spawns a fresh pod, as fast
    // as the user can click. Per-pod status (spawning, running, done/error)
    // lives on the individual "#N" button, not on New.
    //
    // generationOverride: rerun with a stored generation snapshot (result
    // viewer) instead of building from the editor tree.

    const handleGenerate = React.useCallback(async (generationOverride?: GenerationSnapshot) => {
        if (!editingWorkflowId || (!generationOverride && nodes.length === 0)) return;

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
        let isDirect: boolean | undefined;
        try {
            const result = await cloud(baseUrl, { type: 'create' });
            if (!('pod_url' in result)) {
                throw new Error('Pod spawn response did not contain pod_url');
            }
            podUrl = (result as { pod_url: string }).pod_url;
            // The server probed the pod's websocket handshake: true = the
            // pod_url fronts a DIRECT ComfyUI server, false = Tier 2 proxy.
            isDirect = (result as CloudCreateResult).is_direct;
        } catch (err: any) {
            // Spawn failed — no pod_url ever existed; remove the button.
            setPods((prev) => prev.filter((p) => p.id !== podEntry.id));
            alert(`Failed to spawn pod ${podLetter(podNumber)}: ${err.message ?? String(err)}`);
            return;
        }
        console.log(`[Generate] Pod#${podNumber} spawned: ${podUrl} (${isDirect ? 'direct ComfyUI' : 'proxy'})`);

        // Step 3 — pod_url exists: the pod is now usable
        setPods((prev) =>
            prev.map((p) =>
                p.id === podEntry.id ? { ...p, pod_url: podUrl, is_direct: isDirect, status: 'ready', failCount: 0 } : p
            )
        );

        // Step 4 — snapshot + submit for server-side processing.
        // A failure here keeps the pod — its button shows the run error
        // and stays reusable.
        try {
            await runGenerationOnPod(podUrl, podEntry.id, generationOverride, isDirect);
        } catch (err: any) {
            alert(`Failed to generate: ${err.message ?? String(err)}`);
        }
    }, [nodes.length, editingWorkflowId, baseUrl, runGenerationOnPod]);

    // ── Pod button (A00): same as New but reuses an existing pod_url ──
    // NEVER blocked while running: each click queues ANOTHER job on the
    // pod. The server scopes each submission with its own client_id and
    // filters the shared pod stream by prompt_id, so every generation
    // json only receives its own job's events.
    //
    // generationOverride: rerun with a stored generation snapshot (result
    // viewer) instead of building from the editor tree.

    const handlePodGenerate = React.useCallback(
        async (pod: PodEntry, generationOverride?: GenerationSnapshot) => {
            if (!editingWorkflowId || (!generationOverride && nodes.length === 0)) return;
            if (!pod.pod_url || pod.status !== 'ready') return;
            try {
                console.log(`[Pod#${pod.podNumber}] Queueing job on ${pod.pod_url}`);
                await runGenerationOnPod(pod.pod_url, pod.id, generationOverride, pod.is_direct);
            } catch (err: any) {
                alert(`Failed to generate: ${err.message ?? String(err)}`);
            }
        },
        [nodes.length, editingWorkflowId, runGenerationOnPod]
    );

    // ── Auto button: queue on the least-loaded ready pod ───────────
    // The load balancer — never spawns anything; just delegates to the
    // pod button path with pickLeastLoadedPod's choice. No-ops when no
    // pod is ready (the button renders disabled then anyway).
    //
    // generationOverride: rerun with a stored generation snapshot (result
    // viewer) instead of building from the editor tree.

    const handleAutoGenerate = React.useCallback(
        async (generationOverride?: GenerationSnapshot) => {
            // Read through the ref — a click must see the freshest queue
            // depths, not the counts from the last render's closure.
            const pod = pickLeastLoadedPod(podsRef.current);
            if (!pod) {
                console.log('[Auto] No ready pod — click "New" to spawn one first.');
                return;
            }
            console.log(
                `[Auto] Pod#${pod.podNumber} picked — least loaded ` +
                    `(${pod.activeGenerationIds.length} job${pod.activeGenerationIds.length !== 1 ? 's' : ''} in flight)`
            );
            await handlePodGenerate(pod, generationOverride);
        },
        [handlePodGenerate]
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
                            // Alive — clear strikes, refresh health + the
                            // direct/proxy detection, mark ready.
                            setPods((prev) =>
                                prev.map((ep) =>
                                    ep.id === p.id
                                        ? {
                                              ...ep,
                                              status: 'ready',
                                              failCount: 0,
                                              error: undefined,
                                              health: statusResult,
                                              ...(statusResult.is_direct !== undefined
                                                  ? { is_direct: statusResult.is_direct }
                                                  : {})
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

    return { pods, handleGenerate, handlePodGenerate, handleAutoGenerate };
}
