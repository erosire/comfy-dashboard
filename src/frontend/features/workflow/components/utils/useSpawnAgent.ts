// Spawn agent — create a cloud pod and run all pending generations on it.
//
// 1. Calls POST /v1/comfy/cloud with {} to spawn a new pod.
// 2. Filters generations with status "pending" only.
// 3. Marks picked-up generations as "processing" so other agents skip them.
// 4. Streams the NDJSON response back, collecting image results.
// 5. PUTs the results back to the server when done.
//
// Extracted verbatim from the original CloudTab.tsx handleSpawnAgent.

import React from 'react';
import type { GenerationEntry, GenerationResultItem, GenerationSummary } from '../../../../api';
import { cloud, cloudPrompt, cloudReadNdjson } from '../../../../api';
import { base64ByteSize } from './pod-utils';
import { workflowToApiPrompt } from './workflow-prompt';

export type UseSpawnAgentParams = {
    baseUrl: string;
    /** Generation list to scan for pending work (store.generations). */
    generations: GenerationSummary[];
    /** Id of the workflow being edited (store.selectedId). */
    editingWorkflowId: string | null;
    updateGeneration: (
        workflowId: string,
        generateId: string,
        body: Partial<
            Pick<GenerationEntry, 'status' | 'result' | 'generatedTime' | 'completedDate' | 'error'>
        >
    ) => Promise<void>;
    refreshGenerations: (workflowId: string) => Promise<void>;
    fetchGeneration: (workflowId: string, generateId: string) => Promise<GenerationEntry>;
};

export function useSpawnAgent({
    baseUrl,
    generations,
    editingWorkflowId,
    updateGeneration,
    refreshGenerations,
    fetchGeneration
}: UseSpawnAgentParams) {
    const [agentRunning, setAgentRunning] = React.useState(false);
    const [agentCount, setAgentCount] = React.useState(0);
    const [executingNodeId, setExecutingNodeId] = React.useState<string | null>(null);

    const handleSpawnAgent = React.useCallback(async () => {
        if (agentRunning) return;

        // Only pick up "pending" generations — not "processing" or completed ones
        const pendingGenerations = generations.filter((g) => g.status === 'pending');
        if (pendingGenerations.length === 0) {
            console.log('[Agent] No pending generations to process. Click "Generate" first to create a snapshot.');
            return;
        }

        setAgentRunning(true);
        setAgentCount((c) => c + 1);
        const totalStart = performance.now();
        console.log(`[Agent] Spawning cloud pod... (${pendingGenerations.length} pending generations)`);

        // Immediately mark all pending generations as "processing"
        if (editingWorkflowId) {
            for (const gen of pendingGenerations) {
                try {
                    await updateGeneration(editingWorkflowId, gen.id, { status: 'processing' });
                } catch (err: any) {
                    console.warn(`[Agent] Failed to mark generation ${gen.id} as processing:`, err.message);
                }
            }
            // Refresh the list after marking
            await refreshGenerations(editingWorkflowId);
        }

        try {
            // Step 1 — spawn the pod
            const spawnStart = performance.now();
            const result = await cloud(baseUrl, { type: 'create' });
            const spawnMs = performance.now() - spawnStart;
            if (!('pod_url' in result)) {
                console.error('[Agent] Spawn response did not contain pod_url', result);
                setAgentRunning(false);
                return;
            }
            const podUrl = (result as { pod_url: string }).pod_url;
            console.log(`[Agent] Pod spawned in ${(spawnMs / 1000).toFixed(1)}s: ${podUrl}`);

            // Step 2 — iterate generations and submit each prompt
            for (let i = 0; i < pendingGenerations.length; i++) {
                const gen = pendingGenerations[i];
                const genStart = performance.now();
                const collectedResults: GenerationResultItem[] = [];
                console.log(`[Agent] (${i + 1}/${pendingGenerations.length}) Submitting generation ${gen.id}...`);

                try {
                    // The list endpoint returns lightweight summaries (no
                    // prompt), so fetch the full generation to get the
                    // snapshotted prompt before submitting to the pod.
                    const workflowId = editingWorkflowId;
                    if (!workflowId) continue;
                    const fullGen = await fetchGeneration(workflowId, gen.id);
                    console.log(`[Agent] Prompt payload:`, JSON.stringify(fullGen.prompt, null, 2));
                    const apiPrompt = workflowToApiPrompt(fullGen.prompt);
                    console.log(`[Agent] Converted API prompt:`, JSON.stringify(apiPrompt, null, 2));

                    const response = await cloudPrompt(baseUrl, {
                        pod_url: podUrl,
                        prompt: apiPrompt
                    });

                    // Step 3 — stream NDJSON and log each event
                    let executionStartMs: number | null = null;
                    for await (const event of cloudReadNdjson(response)) {
                        const now = performance.now();
                        const elapsed = ((now - genStart) / 1000).toFixed(1);
                        console.log(`[Agent] Event (${gen.id}):`, event.type, event.data, ` [+${elapsed}s]`);

                        // Track currently executing node for visual highlighting
                        if (event.type === 'executing') {
                            const nodeId = (event.data as any)?.node;
                            setExecutingNodeId(nodeId ?? null);
                        }

                        // Capture execution_start timestamp
                        if (event.type === 'execution_start') {
                            executionStartMs = now;
                        }

                        // Capture imagepreview.update — store the data URL as-is.
                        // (blob: URLs die with the page and MUST NOT be persisted
                        // in the generation json; data URLs survive, and the viewer
                        // converts them to throwaway blob URLs on open.)
                        if (event.type === 'imagepreview.update') {
                            const imageData = (event.data as any)?.image as string | undefined;
                            const imageNodeId = (event.data as any)?.node_id as string | undefined;
                            if (imageData && imageData.startsWith('data:')) {
                                const commaIdx = imageData.indexOf(',');
                                if (commaIdx !== -1) {
                                    const meta = imageData.substring(0, commaIdx);
                                    const b64 = imageData.substring(commaIdx + 1);
                                    const mimeMatch = meta.match(/^data:(.*?);/);
                                    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                                    console.log(
                                        `[Agent] Image from node ${imageNodeId}:`,
                                        `MIME: ${mime}`,
                                        `Size: ${base64ByteSize(b64)} bytes`
                                    );
                                    collectedResults.push({
                                        type: 'image',
                                        url: imageData,
                                        mimeType: mime,
                                        size: base64ByteSize(b64),
                                        nodeId: imageNodeId ?? ''
                                    });
                                }
                            }
                        }

                        // Terminal events — stop reading this stream
                        if (
                            event.type === 'proxy_done' ||
                            event.type === 'execution_error' ||
                            event.type === 'proxy_error'
                        ) {
                            const genMs = performance.now() - genStart;
                            const execMs = executionStartMs != null ? performance.now() - executionStartMs : null;
                            const execStr = execMs != null ? `, execution: ${(execMs / 1000).toFixed(1)}s` : '';
                            console.log(
                                `[Agent] Generation ${gen.id} finished (${event.type}) — ` +
                                    `total: ${(genMs / 1000).toFixed(1)}s${execStr}`
                            );
                            break;
                        }
                    }
                    // Clear executing node highlight when generation completes
                    setExecutingNodeId(null);

                    // Step 4 — PUT results back to the server
                    if (editingWorkflowId) {
                        const genFinishTime = new Date().toISOString();
                        const genTotalMs = performance.now() - genStart;
                        try {
                            await updateGeneration(editingWorkflowId, gen.id, {
                                status: 'completed',
                                result: collectedResults,
                                generatedTime: `${(genTotalMs / 1000).toFixed(1)}s`,
                                completedDate: genFinishTime
                            });
                            console.log(
                                `[Agent] PUT generation ${gen.id}: completed with ${collectedResults.length} result(s)`
                            );
                        } catch (err: any) {
                            console.error(`[Agent] Failed to PUT generation ${gen.id}:`, err.message);
                        }
                    }
                } catch (err: any) {
                    const genMs = performance.now() - genStart;
                    console.error(
                        `[Agent] Failed to submit generation ${gen.id} after ${(genMs / 1000).toFixed(1)}s:`,
                        err.message ?? String(err)
                    );
                    // Mark as failed
                    if (editingWorkflowId) {
                        try {
                            await updateGeneration(editingWorkflowId, gen.id, {
                                status: 'failed',
                                error: err.message ?? String(err)
                            });
                        } catch {
                            /* ignore */
                        }
                    }
                }
            }

            const totalMs = performance.now() - totalStart;
            console.log(`[Agent] All generations processed — total wall time: ${(totalMs / 1000).toFixed(1)}s`);
        } catch (err: any) {
            const totalMs = performance.now() - totalStart;
            console.error(`[Agent] Spawn failed after ${(totalMs / 1000).toFixed(1)}s:`, err.message ?? String(err));
        } finally {
            setAgentRunning(false);
            // Refresh generations to reflect updated statuses
            if (editingWorkflowId) {
                refreshGenerations(editingWorkflowId);
            }
        }
    }, [
        agentRunning,
        baseUrl,
        generations,
        editingWorkflowId,
        updateGeneration,
        refreshGenerations,
        fetchGeneration
    ]);

    return { agentRunning, agentCount, executingNodeId, handleSpawnAgent };
}
