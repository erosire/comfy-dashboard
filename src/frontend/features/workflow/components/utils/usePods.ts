// Cloud pod lifecycle — pod creation/reuse for the New / GPU-labeled pod
// / Auto buttons, run-state sync from polled generations, and the server
// pod-list poll that owns pod button liveness.
//
// Extracted from the original CloudTab.tsx. Behaviour notes:
//   - New is NEVER blocked: the GPU picker dialog (GpuSelectDialog) asks
//     for the GPU ("4090" / "B300", see GPU_OPTIONS), and every pick
//     spawns a fresh pod for that GPU. Per-pod status lives on the pod
//     button (labeled e.g. "4090x3" = a 4090 pod with 3 jobs queued).
//   - Pods accept concurrent jobs: each "#N" click queues another job; the
//     server rides all of them on the pod's one persistent websocket and
//     scopes events by prompt_id. "Auto" queues on the least-loaded ready
//     pod (see pickLeastLoadedPod).
//   - LIVENESS IS THE SERVER'S JOB: every POD_LIST_POLL_MS the hook fetches
//     GET /v1/comfy/cloud — the registry of pods whose persistent websocket
//     the server still holds. A pod drops out of the list the moment its
//     socket dies: pods are designed to terminate when idle and never come
//     back (see server pod-socket.ts — no reconnection is attempted). The
//     pod buttons are a pure MIRROR of that list:
//       * listed but unknown locally      → add a ready button (spawned by
//         another client, page refresh, …);
//       * known locally but NOT listed    → the pod is dead for good;
//         remove the button (its in-flight generations already failed
//         server-side with prompt_error and settle through generation
//         polling);
//       * listed and known                → stays;
//       * local placeholder with no pod_url yet (create in flight) → the
//         list cannot judge it; untouched either way.
//     There are deliberately NO per-pod status probes / heartbeat strikes /
//     idle expiry timers — pinging pods is the server-side socket's job.
//     A failed LIST fetch skips the whole tick: an unreachable server never
//     clears local buttons (removals need a definitive server answer).

import React from 'react';
import type { GenerationEntry, GenerationSummary } from '../../../../api';
import { cloudCreate, cloudListPods, cloudPrompt, fetchPreferenceVariables } from '../../../../api';
import type { UINode } from '../../../../nodes/node-type';
import type { PodEntry, RunState } from './types';
import { POD_LIST_POLL_MS } from './constants';
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
    //    consumes the pod's stream and updates the generation json by
    //    itself — this call returns immediately (202).
    // 4. Client-side we are done: the continuous generations polling
    //    updates the sidebar with progress, and settles the pod button's
    //    running → done/error state (see the sync effect above).

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
        },
        [baseUrl, editingWorkflowId, workflowName, getCurrentRaw, generateWorkflow]
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

    // ── Pod button (A00): same as New but reuses an existing pod_url ──
    // NEVER blocked while running: each click queues ANOTHER job on the
    // pod. The server marks each submission with its own prompt_id and
    // demultiplexes the shared pod stream by it, so every generation
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

    // ── Server pod-list polling — the pod buttons' ONLY liveness source ─
    // GET /v1/comfy/cloud returns every pod whose persistent websocket the
    // server still holds; the pod buttons are a pure mirror of it:
    // unknown listed pods are ADDED as ready buttons (spawned elsewhere,
    // page refresh), and local pods that STOP being listed are REMOVED —
    // pods are designed to die when idle and never reconnect, so the server
    // deregistering one is a definitive death verdict, not a timeout guess.
    //
    // A failed LIST request skips the tick entirely: an unreachable server
    // must never clear the local buttons.
    React.useEffect(() => {
        let running = false;
        const syncServerPods = async () => {
            if (running) return; // previous tick still in flight — skip
            running = true;
            try {
                const { pods: serverPods } = await cloudListPods(baseUrl);
                // The authoritative liveness set, keyed the same way the
                // server keys its registry (URL.toString() normalization).
                const serverUrls = new Set(serverPods.map((sp) => normalizePodUrl(sp.pod_url)));

                // Additions are computed against the freshest state (ref) —
                // a slow poll must not re-add a pod the user lost since;
                // the commit below re-dedupes atomically.
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
                    additions.push({
                        id: `gen-pod-${Date.now()}-${podNumber}`,
                        podNumber,
                        name: podLetter(podNumber),
                        gpu: serverPod.gpu,
                        pod_url: serverPod.pod_url,
                        status: 'ready',
                        activeGenerationIds: [],
                        run: { status: 'idle' }
                    });
                }

                setPods((prev) => {
                    // Removals: resolved pods the server stopped listing.
                    // Placeholders (pod_url === '' — create still in flight)
                    // are invisible to the server list and never judged.
                    const removed: PodEntry[] = [];
                    const kept = prev.filter((p) => {
                        if (!p.pod_url) return true;
                        if (serverUrls.has(normalizePodUrl(p.pod_url))) return true;
                        removed.push(p);
                        return false;
                    });

                    // Re-dedupe the additions against the commit-time state:
                    // a pod added between the fetch and this commit (spawn
                    // resolution, earlier poll) must not duplicate.
                    const prevUrls = new Set(
                        kept.filter((p) => p.pod_url).map((p) => normalizePodUrl(p.pod_url))
                    );
                    const fresh = additions.filter((a) => {
                        const normalized = normalizePodUrl(a.pod_url);
                        if (prevUrls.has(normalized)) return false;
                        prevUrls.add(normalized);
                        return true;
                    });

                    if (removed.length === 0 && fresh.length === 0) return prev;
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
                    return [...kept, ...fresh];
                });
            } catch {
                // The LIST endpoint itself failed — skip the tick. Buttons
                // are only ever reconciled from a definitive server answer.
            } finally {
                running = false;
            }
        };
        void syncServerPods();
        const interval = setInterval(() => void syncServerPods(), POD_LIST_POLL_MS);
        return () => clearInterval(interval);
    }, [baseUrl]);

    return { pods, handleGenerate, handlePodGenerate, handleAutoGenerate };
}
