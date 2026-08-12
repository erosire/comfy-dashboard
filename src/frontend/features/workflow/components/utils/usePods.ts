// Cloud pod lifecycle — pod creation/reuse for the New / GPU-labeled pod
// / Auto buttons, and the server pod-list poll that owns pod button
// liveness AND queue state.
//
// Extracted from the original CloudTab.tsx. Behaviour notes:
//   - New is NEVER blocked: the GPU picker dialog (GpuSelectDialog) asks
//     for a GPU from the API's available_gpus response, and every pick
//     spawns a fresh pod for that GPU. Per-pod status lives on the pod
//     button (labeled e.g. "4090" + a badge with the queued job count).
//   - Pods accept concurrent jobs: each click queues another job; the
//     server rides all of them on the pod's one persistent websocket and
//     scopes events by prompt_id. "Auto" queues on the least-loaded ready
//     pod (see pickLeastLoadedPod).
//   - THE SERVER TRACKS EVERYTHING (pod-socket.ts): every cloud instance
//     it created and each instance's queue (prompt ids, queued/running
//     status, workflow/generation ids). The UI PULLS this from GET
//     /v1/comfy/cloud and keeps NO queue bookkeeping of its own:
//       * badge counts and the Auto balancer read each entry's
//         server-reported `queue` length verbatim;
//       * a successful submit triggers an immediate list refresh so the
//         accepted job shows without waiting for the next poll tick;
//       * the server terminates idle pods itself (empty queue + idle
//         timeout) and unreachable pods (socket death) — both leave the
//         list, so the buttons mirror the list and nothing else.
//   - Run-state SETTLE (the done/error border ring): queue entries vanish
//     server-side at the run's terminal event, so a poll sees "entry gone"
//     but not WHY. The vanished generation ids are remembered in
//     settleWatchRef (per pod) and evaluated against the generations poll:
//     all settled → done, any failed → error, foreign ids (other
//     workflows) → no local verdict. This is comparison of two API
//     snapshots, not own state.

import React from 'react';
import type { CloudPodListEntry, GenerationEntry, GenerationSummary } from '../../../../api';
import { GPU_LIST_POLL_INTERVAL_MS } from '../../../../config';
import { cloudCreate, cloudListPods, cloudPrompt, fetchPreferenceVariables } from '../../../../api';
import type { UINode } from '@underload/comfy';
import type { PodEntry, RunState } from './types';
import { podLetter, pickLeastLoadedPod } from './pod-utils';
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
    /**
     * Polled generations (store.generations) — the verdict source for
     * settling a pod's run state once its server-reported queue drains.
     */
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

/**
 * Verdict for a pod whose server-reported queue drained: all watched
 * generation ids settled → done / error; any still pending/processing →
 * keep waiting (the generations poll runs on the same 3 s cadence and
 * re-evaluates). Ids unknown to this workflow's generation list are
 * foreign (another workflow's jobs) — they carry NO local verdict.
 */
type SettleVerdict = { state: 'pending' } | { state: 'settled'; run: RunState };

function evaluateSettledGenerations(ids: string[], generations: GenerationSummary[]): SettleVerdict {
    let failed: GenerationSummary | null = null;
    let waiting = false;
    for (const id of ids) {
        const generation = generations.find((g) => g.id === id);
        if (!generation) continue; // foreign workflow — dropped from the watch
        if (generation.status === 'pending' || generation.status === 'processing') {
            waiting = true;
            continue;
        }
        if (generation.status === 'failed' && !failed) failed = generation;
    }
    if (waiting) return { state: 'pending' };
    if (failed) {
        return { state: 'settled', run: { status: 'error', events: [], message: failed.error ?? 'Generation failed' } };
    }
    return { state: 'settled', run: { status: 'done', events: [] } };
}

/**
 * Merge one listed pod's SERVER-REPORTED queue into its button entry.
 * Queue membership is replaced verbatim (the UI tracks nothing); the only
 * derived concern is the run-state ring:
 *   - queue non-empty → running (busy ring);
 *   - queue drained → entries that vanished since the last poll are joined
 *     into the pod's settle-watch and evaluated against the generations
 *     poll (see evaluateSettledGenerations); while a verdict is pending the
 *     ring stays running.
 * `watch` is the per-pod-id settle-watch map (lost, not-yet-settled
 * generation ids) — snapshot-diff data, never queue bookkeeping.
 */
function reconcilePodQueue(
    pod: PodEntry,
    serverPod: CloudPodListEntry,
    generations: GenerationSummary[],
    watch: Map<string, string[]>
): PodEntry {
    const nextQueue = serverPod.queue ?? [];
    const nextIds = new Set(nextQueue.map((q) => q.prompt_id));
    // Entries present in the last snapshot but gone now settled server-side
    // — remember their generation ids until the generations poll answers.
    const lostGenerationIds = pod.queue
        .filter((q) => !nextIds.has(q.prompt_id) && typeof q.generation_id === 'string' && q.generation_id)
        .map((q) => q.generation_id as string);
    const watched = watch.get(pod.id) ?? [];
    for (const id of lostGenerationIds) {
        if (!watched.includes(id)) watched.push(id);
    }

    if (nextQueue.length > 0) {
        // Busy (again) — an open settle verdict is superseded.
        if (watch.has(pod.id)) watch.delete(pod.id);
        const run: RunState = pod.run.status === 'running' ? pod.run : { status: 'running', events: [] };
        return { ...pod, queue: nextQueue, run };
    }

    if (watched.length > 0) {
        watch.set(pod.id, watched);
        const verdict = evaluateSettledGenerations(watched, generations);
        if (verdict.state === 'pending') {
            // The generations poll has not caught up with the settled
            // server queue yet — keep the ring spinning and re-evaluate
            // from the generations-change effect.
            const run: RunState = pod.run.status === 'running' ? pod.run : { status: 'running', events: [] };
            return { ...pod, queue: nextQueue, run };
        }
        watch.delete(pod.id);
        return { ...pod, queue: nextQueue, run: verdict.run };
    }

    return { ...pod, queue: nextQueue };
}

export function usePods({ baseUrl, nodes, editingWorkflowId, workflowName, generations, getCurrentRaw, generateWorkflow }: UsePodsParams) {
    const [pods, setPods] = React.useState<PodEntry[]>([]);
    // GPU choices are server configuration, so the picker reads this state
    // from GET /v1/comfy/cloud instead of importing or duplicating secrets.
    const [availableGpus, setAvailableGpus] = React.useState<string[]>([]);
    // Monotonic counter for naming generation pods ("#1", "#2", …)
    const podCounterRef = React.useRef(0);
    const podsRef = React.useRef(pods);
    podsRef.current = pods;
    // Fresh generations for the poll closure — the poll's cadence is
    // decoupled from the generations poll, so the reconcile path reads
    // the newest snapshot through this ref instead of a stale closure.
    const generationsRef = React.useRef(generations);
    generationsRef.current = generations;
    // Per-pod ids of generations that left the server queue and have not
    // settled in the generations poll yet (see reconcilePodQueue).
    const settleWatchRef = React.useRef(new Map<string, string[]>());

    // ── Settle runs whose queue entries settled while the generations
    // poll was lagging behind the pod-list poll ───────────────────────
    // The pod-list reconcile defers to this effect whenever a watched id
    // is still pending/processing in the generations snapshot; each fresh
    // generations snapshot re-evaluates until the verdict lands.
    React.useEffect(() => {
        const watch = settleWatchRef.current;
        if (watch.size === 0) return;
        setPods((prev) => {
            let changed = false;
            const next = prev.map((p) => {
                const ids = watch.get(p.id);
                if (!ids || ids.length === 0 || p.queue.length > 0) return p;
                const verdict = evaluateSettledGenerations(ids, generations);
                if (verdict.state === 'pending') return p;
                watch.delete(p.id);
                changed = true;
                return { ...p, run: verdict.run };
            });
            return changed ? next : prev;
        });
    }, [generations]);

    // ── Server pod-list poll — liveness AND queue truth ──────────────
    // GET /v1/comfy/cloud returns every pod whose persistent websocket the
    // server still holds, each with its server-tracked queue. The pod
    // buttons are a pure mirror:
    //   * unknown listed pods are ADDED as ready buttons (spawned
    //     elsewhere, page refresh) — queue included;
    //   * local pods that STOP being listed are REMOVED (idle-timeout or
    //     unreachable termination — both are definitive server verdicts);
    //   * listed known pods get their `queue` replaced verbatim and their
    //     run-state ring settled from the snapshot diff.
    // A failed LIST request skips the tick: an unreachable server never
    // clears or rewrites local buttons (removals need a definitive answer).
    const refreshPods = React.useCallback(async () => {
        const { pods: serverPods, available_gpus } = await cloudListPods(baseUrl);
        // Replace the complete list on every authoritative response so removed
        // secret keys disappear from the UI on the next poll as well.
        setAvailableGpus(available_gpus ?? []);
        // The authoritative liveness set, keyed the same way the server
        // keys its registry (URL.toString() normalization).
        const serverUrls = new Set(serverPods.map((sp) => normalizePodUrl(sp.pod_url)));
        const serverByUrl = new Map(serverPods.map((sp) => [normalizePodUrl(sp.pod_url), sp] as const));

        // Additions are computed against the freshest state (ref) — a slow
        // poll must not re-add a pod the user lost since; the commit below
        // re-dedupes atomically.
        const knownUrls = new Set(
            podsRef.current.filter((p) => p.pod_url).map((p) => normalizePodUrl(p.pod_url))
        );
        const additions: PodEntry[] = [];
        for (const serverPod of serverPods) {
            const normalized = normalizePodUrl(serverPod.pod_url);
            if (knownUrls.has(normalized)) continue;
            knownUrls.add(normalized);
            podCounterRef.current += 1;
            const podNumber = podCounterRef.current;
            const queue = serverPod.queue ?? [];
            additions.push({
                id: `gen-pod-${Date.now()}-${podNumber}`,
                podNumber,
                name: podLetter(podNumber),
                gpu: serverPod.gpu,
                pod_url: serverPod.pod_url,
                status: 'ready',
                queue,
                // An adopted pod with a loaded queue already spins.
                run: queue.length > 0 ? { status: 'running', events: [] } : { status: 'idle' }
            });
        }

        setPods((prev) => {
            // Removals: resolved pods the server stopped listing.
            // Placeholders (pod_url === '' — create still in flight) are
            // invisible to the server list and never judged.
            const removed: PodEntry[] = [];
            const kept = prev.filter((p) => {
                if (!p.pod_url) return true;
                if (serverUrls.has(normalizePodUrl(p.pod_url))) return true;
                removed.push(p);
                return false;
            });

            // Queue reconcile: replace each kept pod's queue with the
            // server answer and settle/advance its run-state ring.
            const merged = kept.map((p) => {
                if (!p.pod_url) return p;
                const serverPod = serverByUrl.get(normalizePodUrl(p.pod_url));
                if (!serverPod) return p;
                return reconcilePodQueue(p, serverPod, generationsRef.current, settleWatchRef.current);
            });

            // Re-dedupe the additions against the commit-time state: a pod
            // added between the fetch and this commit (spawn resolution,
            // earlier poll) must not duplicate.
            const prevUrls = new Set(
                merged.filter((p) => p.pod_url).map((p) => normalizePodUrl(p.pod_url))
            );
            const fresh = additions.filter((a) => {
                const normalized = normalizePodUrl(a.pod_url);
                if (prevUrls.has(normalized)) return false;
                prevUrls.add(normalized);
                return true;
            });

            const queueChanged = merged.some((p, i) => p !== kept[i]);
            if (removed.length === 0 && fresh.length === 0 && !queueChanged) return prev;
            if (removed.length > 0) {
                console.warn(
                    `[Pods] Server no longer holds ${removed.length} pod(s) — removing button(s): ` +
                        removed.map((p) => `Pod#${p.podNumber} (${p.pod_url})`).join(', ')
                );
            }
            if (fresh.length > 0) {
                console.log(
                    `[Pods] Server reported ${fresh.length} unknown pod(s) — adding buttons: ` +
                        fresh.map((a) => a.pod_url).join(', ')
                );
            }
            return [...merged, ...fresh];
        });
    }, [baseUrl]);

    React.useEffect(() => {
        let running = false;
        const tick = async () => {
            if (running) return; // previous tick still in flight — skip
            running = true;
            try {
                await refreshPods();
            } catch {
                // The LIST endpoint itself failed — skip the tick. Buttons
                // are only ever reconciled from a definitive server answer.
            } finally {
                running = false;
            }
        };
        void tick();
        const interval = setInterval(() => void tick(), GPU_LIST_POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [refreshPods]);

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
    //    consumes the pod's stream and updates the generation json by
    //    itself — this call returns immediately (202).
    // 4. Client-side we are done: the server now owns the pod's queue
    //    entry (extra_data carries the workflow/generation ids), so an
    //    immediate pod-list refresh reflects the accepted job; the
    //    continuous polls keep the queue + generations up to date.

    const runGenerationOnPod = React.useCallback(
        async (podUrl: string, podId?: string, generationOverride?: GenerationSnapshot) => {
            const snapshot = generationOverride ?? getCurrentRaw?.() ?? null;
            if (!editingWorkflowId || !snapshot) return;

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
                // The server owns the native websocket, the POST /prompt
                // connection AND the pod's queue entry from this point; the
                // client only mirrors the server answers.
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
                // Accepted — pull the fresh queue NOW (the 202 already
                // implies the server-side queue entry; the next poll tick
                // is up to GPU_LIST_POLL_INTERVAL_MS away).
                refreshPods().catch(() => undefined);
            } catch (err: any) {
                const message = err.message ?? String(err);
                // Submission itself failed — surface an error on the
                // button; the next successful poll still owns the truth.
                if (podId) {
                    setPods((prev) =>
                        prev.map((p) =>
                            p.id === podId && p.queue.length === 0
                                ? { ...p, run: { status: 'error', events: [], message } }
                                : p
                        )
                    );
                }
                throw err;
            }
        },
        [baseUrl, editingWorkflowId, workflowName, getCurrentRaw, generateWorkflow, refreshPods]
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
    // gpu: the GPU key chosen from the API-backed dialog — sent to
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
            queue: [],
            run: { status: 'idle' }
        };
        setPods((prev) => [...prev, podEntry]);

        // Step 2 — create the cloud pod on the requested GPU (the server
        // falls through that GPU's spawner list and 503s when none can
        // spawn it — the error text carries the per-server attempts).
        console.log(`[Generate] Spawning Pod#${podNumber} on gpu=${gpu}...`);
        let podUrl: string;
        try {
            const result = await cloudCreate(baseUrl, { gpu });
            podUrl = result.pod_url;
            if (!podUrl) {
                throw new Error('Pod spawn response did not contain pod_url');
            }
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
                .map((p) => (p.id === podEntry.id ? { ...p, pod_url: podUrl, status: 'ready' } : p));
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

    // ── Pod button: same as New but reuses an existing pod_url ─────
    // NEVER blocked while running: each click queues ANOTHER job on the
    // pod. The server marks each submission with its own prompt_id, tracks
    // it in the pod's queue list, and demultiplexes the shared pod stream
    // by it, so every generation json only receives its own job's events.
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
    // pod button path with pickLeastLoadedPod's choice (least-loaded by
    // the SERVER-REPORTED queue). No-ops when no pod is ready (the button
    // renders disabled then anyway).
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
                    `(${pod.queue.length} job${pod.queue.length !== 1 ? 's' : ''} in flight)`
            );
            await handlePodGenerate(pod, generationOverride);
        },
        [handlePodGenerate]
    );

    // Return the API-derived GPU keys with the pod handlers so the dashboard
    // dialog and generation flow share one server-authoritative snapshot.
    return { pods, availableGpus, handleGenerate, handlePodGenerate, handleAutoGenerate };
}
