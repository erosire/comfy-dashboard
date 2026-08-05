// Cloud pod lifecycle — pod creation/reuse for the New / GPU-labeled pod
// / Auto buttons, run-state sync from polled generations, server pod-list
// polling (GET /v1/comfy/cloud auto-adds buttons for pods the server
// tracks), and the heartbeat that detects dead pod_urls.
//
// Extracted from the original CloudTab.tsx. Behaviour notes preserved:
//   - New is NEVER blocked: the GPU picker dialog (GpuSelectDialog) asks
//     for the GPU ("4090" / "B300", see GPU_OPTIONS), and every pick
//     spawns a fresh pod for that GPU. Per-pod status lives on the pod
//     button (labeled e.g. "4090x3" = a 4090 pod with 3 jobs queued).
//   - Pods accept concurrent jobs: each "#N" click queues another job; the
//     server rides all of them on the pod's one persistent websocket and
//     scopes events by prompt_id. "Auto" queues on the least-loaded ready
//     pod (see pickLeastLoadedPod).
//   - Server pod-list polling every POD_HEARTBEAT_MS adds buttons for
//     server-tracked pods the UI does not know yet; heartbeat status probes
//     verify every known pod — MAX_POD_FAILURES consecutive failures remove
//     the pod. A pod is also removed after POD_IDLE_MS with no accepted
//     generation queue.

import React from 'react';
import type { CloudPodStatusResult, GenerationEntry, GenerationSummary } from '../../../../api';
import { cloud, cloudListPods, cloudPrompt, fetchPreferenceVariables } from '../../../../api';
import type { UINode } from '../../../../nodes/node-type';
import type { PodEntry, RunState } from './types';
import { MAX_POD_FAILURES, POD_HEARTBEAT_MS, POD_IDLE_MS } from './constants';
import { isPodIdle, podLetter, pickLeastLoadedPod, shouldProbePod } from './pod-utils';
import { replacePreferenceVariables } from './workflow-prompt';

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

/**
 * Normalize a pod URL for cross-side comparisons. The server registry keys
 * pods by URL.toString() (a bare host gains a trailing slash), while the UI
 * stores the spawner's Location verbatim — raw string equality would miss.
 */
function normalizePodUrl(url: string): string {
    try {
        return new URL(url).toString();
    } catch {
        return url;
    }
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
    // One timer is kept per native pod so unrelated pod updates cannot reset
    // another pod's exact 60-second idle deadline.
    const directIdleTimersRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    // A generation request is considered pending before the server accepts it;
    // this prevents a slow snapshot/submission from being removed as "idle".
    const pendingGenerationPodIdsRef = React.useRef<Set<string>>(new Set());
    podsRef.current = pods;

    // Cancel an idle timer immediately when the user starts another job on a
    // native pod, before the asynchronous generation request can be accepted.
    const cancelDirectIdleTimer = React.useCallback((podId: string) => {
        const timer = directIdleTimersRef.current.get(podId);
        if (timer === undefined) return;
        clearTimeout(timer);
        directIdleTimersRef.current.delete(podId);
    }, []);

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

    // Arm the exact idle deadline for every native pod whose accepted queue is
    // empty. The callback rechecks current state, so a completion race or a
    // newly accepted job can never remove a busy button.
    React.useEffect(() => {
        const timers = directIdleTimersRef.current;
        const eligibleIds = new Set(
            pods
                .filter((pod) => isPodIdle(pod) && !pendingGenerationPodIdsRef.current.has(pod.id))
                .map((pod) => pod.id)
        );

        for (const [podId, timer] of timers) {
            if (!eligibleIds.has(podId)) {
                clearTimeout(timer);
                timers.delete(podId);
            }
        }

        for (const podId of eligibleIds) {
            if (timers.has(podId)) continue;
            const pod = pods.find((entry) => entry.id === podId)!;
            const timer = setTimeout(() => {
                timers.delete(podId);
                setPods((previous) => {
                    const current = previous.find((entry) => entry.id === podId);
                    if (!current || !isPodIdle(current) || pendingGenerationPodIdsRef.current.has(podId)) {
                        return previous;
                    }
                    console.log(
                        `[Idle] Removing ComfyUI Pod#${current.podNumber} after ${POD_IDLE_MS / 1000}s with no queued jobs`
                    );
                    return previous.filter((entry) => entry.id !== podId);
                });
            }, POD_IDLE_MS);
            timers.set(pod.id, timer);
        }
    }, [pods]);

    // Timers are process-local UI resources and must not survive hook unmount.
    React.useEffect(() => {
        return () => {
            for (const timer of directIdleTimersRef.current.values()) clearTimeout(timer);
            directIdleTimersRef.current.clear();
            pendingGenerationPodIdsRef.current.clear();
        };
    }, []);

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
        async (podUrl: string, podId?: string, generationOverride?: GenerationSnapshot) => {
            const snapshot = generationOverride ?? getCurrentRaw?.() ?? null;
            if (!editingWorkflowId || !snapshot) return;

            // Reserve the direct pod before any asynchronous snapshot work so
            // a slow server request cannot be mistaken for an idle queue.
            if (podId) {
                pendingGenerationPodIdsRef.current.add(podId);
                cancelDirectIdleTimer(podId);
            }

            try {
                // Resolve the default preference profile at the UI boundary so
                // the server receives a self-contained workflow document rather
                // than a second preference payload. A preference API outage is
                // treated as an empty profile, which still removes every token.
                let preferences: Record<string, unknown> = {};
                try {
                    preferences = await fetchPreferenceVariables(baseUrl);
                } catch {
                    preferences = {};
                }
                const preparedSnapshot = replacePreferenceVariables(snapshot, preferences);

                // Step 1+2 — snapshot the already-prepared workflow json into a
                // generation file. The generation is named after the workflow +
                // current local timestamp by default (the server falls back to
                // its own timestamp id when no name is passed).
                const generationName = workflowName ? `${workflowName}_${localTimestampFile(new Date())}` : undefined;
                const generation = await generateWorkflow(editingWorkflowId, preparedSnapshot, generationName);
                console.log(`[Generate] Created generation ${generation.id} — submitting to ${podUrl}`);

                try {
                    // Step 3 — submit the already-prepared workflow and be done.
                    // The server owns the native websocket and POST /prompt
                    // connection from this point; the client only tracks the
                    // accepted generation through polling.
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
            } finally {
                if (podId) {
                    pendingGenerationPodIdsRef.current.delete(podId);
                    // A snapshot failure does not otherwise mutate pod state;
                    // clone the matching entry to let the idle effect re-arm.
                    setPods((prev) =>
                        prev.map((p) => (p.id === podId ? { ...p } : p))
                    );
                }
            }
        },
        [baseUrl, editingWorkflowId, workflowName, getCurrentRaw, generateWorkflow, cancelDirectIdleTimer]
    );

    // ── New workflow ───────────────────────────────────────────────
    // Creates a cloud pod first, then runs a new generation snapshot on it
    // via POST /v1/comfy/cloud/prompt. The GPU is picked by the user in
    // the New-pod dialog (GpuSelectDialog) — the button appears
    // IMMEDIATELY on pick — in "spawning" state (spinner) while the
    // pod_url is being resolved — then flips to ready. Clicking a ready
    // pod button does the same thing but reuses that pod (skipping pod
    // creation).
    //
    // New is NEVER blocked: every pick spawns a fresh pod, as fast
    // as the user can click. Per-pod status (spawning, running, done/error)
    // lives on the individual pod button, not on New.
    //
    // gpu: the GPU key chosen in the dialog ("4090", "B300", …) — sent to
    // POST /v1/comfy/cloud, whose server walks that GPU's spawner server
    // list (comfyCloudServiceEndpoint) in order.
    // generationOverride: rerun with a stored generation snapshot (result
    // viewer) instead of building from the editor tree.

    const handleGenerate = React.useCallback(async (gpu: string, generationOverride?: GenerationSnapshot) => {
        if (!editingWorkflowId || (!generationOverride && nodes.length === 0)) return;

        // Step 1 — register the pod entry immediately so the pod
        // button shows up while the pod_url is still being resolved. The
        // requested GPU is stored right away — the button labels itself
        // from it even before the server answers.
        podCounterRef.current += 1;
        const podNumber = podCounterRef.current;
        const podEntry: PodEntry = {
            id: `gen-pod-${Date.now()}-${podNumber}`,
            podNumber,
            name: podLetter(podNumber),
            gpu,
            pod_url: '',
            status: 'spawning',
            failCount: 0,
            activeGenerationIds: [],
            run: { status: 'idle' }
        };
        setPods((prev) => [...prev, podEntry]);

        // Step 2 — create the cloud pod on the requested GPU (the server
        // falls through that GPU's spawner list and 503s when none can
        // spawn it — the error text carries the per-server attempts).
        console.log(`[Generate] Spawning Pod#${podNumber} on gpu=${gpu}...`);
        let podUrl: string;
        try {
            const result = await cloud(baseUrl, { type: 'create', gpu });
            if (!('pod_url' in result)) {
                throw new Error('Pod spawn response did not contain pod_url');
            }
            podUrl = (result as { pod_url: string }).pod_url;
        } catch (err: any) {
            // Spawn failed — no pod_url ever existed; remove the button.
            setPods((prev) => prev.filter((p) => p.id !== podEntry.id));
            alert(`Failed to spawn ${gpu} pod: ${err.message ?? String(err)}`);
            return;
        }
        console.log(`[Generate] Pod#${podNumber} spawned: ${podUrl} (ComfyUI websocket)`);

        // Step 3 — pod_url exists: the pod is now usable. Merge race: the
        // server pod-list poll may have already added this pod's button
        // (normalized URL match) while the spawn request was in flight —
        // drop that duplicate so exactly one button survives.
        setPods((prev) => {
            const normalized = normalizePodUrl(podUrl);
            return prev
                .filter((p) => p.id === podEntry.id || !p.pod_url || normalizePodUrl(p.pod_url) !== normalized)
                .map((p) =>
                    p.id === podEntry.id ? { ...p, pod_url: podUrl, status: 'ready', failCount: 0 } : p
                );
        });

        // Step 4 — snapshot + submit for server-side processing.
        // A failure here keeps the pod — its button shows the run error
        // and stays reusable.
        try {
            await runGenerationOnPod(podUrl, podEntry.id, generationOverride);
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
                await runGenerationOnPod(pod.pod_url, pod.id, generationOverride);
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

    // ── Server pod-list polling (auto-update the pod buttons) ────────
    // GET /v1/comfy/cloud returns every pod whose persistent websocket the
    // server currently holds. Pods the UI does not know yet — spawned by
    // another client, or surviving a page refresh while the server kept
    // running — are added as ready pod buttons automatically.
    //
    // Removal is intentionally NOT done here: disappearing from the list
    // means the cloud server terminated the pod's socket, and the per-pod
    // heartbeat strikes (below) already own the error → removal path.
    React.useEffect(() => {
        let running = false;
        const syncServerPods = async () => {
            if (running) return;
            running = true;
            try {
                const { pods: serverPods } = await cloudListPods(baseUrl);
                const activePods = serverPods.filter((sp) => sp.active);
                if (activePods.length === 0) return;

                // Compare against the freshest state via the ref — a slow
                // poll must not re-add a pod the user already removed.
                const knownUrls = new Set(
                    podsRef.current.filter((p) => p.pod_url).map((p) => normalizePodUrl(p.pod_url))
                );
                const additions: PodEntry[] = [];
                for (const serverPod of activePods) {
                    const normalized = normalizePodUrl(serverPod.pod_url);
                    if (knownUrls.has(normalized)) continue;
                    knownUrls.add(normalized);
                    podCounterRef.current += 1;
                    const podNumber = podCounterRef.current;
                    additions.push({
                        id: `gen-pod-${Date.now()}-${podNumber}`,
                        podNumber,
                        name: podLetter(podNumber),
                        gpu: serverPod.gpu,
                        pod_url: serverPod.pod_url,
                        status: 'ready',
                        failCount: 0,
                        activeGenerationIds: [],
                        run: { status: 'idle' }
                    });
                }
                if (additions.length === 0) return;
                console.log(
                    `[Pods] Server reported ${additions.length} unknown pod(s) — adding buttons: ` +
                        additions.map((a) => a.pod_url).join(', ')
                );
                // Re-check inside the updater: a pod added between the
                // async fetch and this commit must not duplicate.
                setPods((prev) => {
                    const prevUrls = new Set(
                        prev.filter((p) => p.pod_url).map((p) => normalizePodUrl(p.pod_url))
                    );
                    const fresh = additions.filter((a) => !prevUrls.has(normalizePodUrl(a.pod_url)));
                    return fresh.length > 0 ? [...prev, ...fresh] : prev;
                });
            } catch {
                // Best-effort — the heartbeat's strike path still owns
                // dead-pod detection when the list endpoint is unreachable.
            } finally {
                running = false;
            }
        };
        void syncServerPods();
        const interval = setInterval(() => void syncServerPods(), POD_HEARTBEAT_MS);
        return () => clearInterval(interval);
    }, [baseUrl]);

    // ── Native ComfyUI heartbeat ─────────────────────────────────────
    // Every websocket-backed status probe resets the pod's strike counter on
    // success. A failure (pod unreachable or health.healthy === false) records a strike:
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
                    if (!shouldProbePod(p)) continue;
                    try {
                        const result = await cloud(baseUrl, { type: 'status', pod_url: p.pod_url });
                        const statusResult = result as CloudPodStatusResult;
                        const healthy = 'health' in result ? statusResult.health?.healthy !== false : true;
                        if (healthy) {
                            // Alive — clear strikes, refresh native health, and
                            // mark the button ready.
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

    return { pods, handleGenerate, handlePodGenerate, handleAutoGenerate };
}
