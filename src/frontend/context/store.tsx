// Context store for the comfy-dashboard.
//
// Manages the reactive state for workflows, queue, and server status.
// Uses plain React context + useState (same pattern as the story-generator).

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { GENERATION_STATUS_POLL_INTERVAL_MS, resolveDefaultBaseUrl } from '../config';
import {
    deleteWorkflow as deleteWorkflowApi,
    fetchWorkflows,
    fetchWorkflow,
    createWorkflow as createWorkflowApi,
    updateWorkflow as updateWorkflowApi,
    generateWorkflow as generateWorkflowApi,
    fetchGenerations as fetchGenerationsApi,
    fetchGeneration as fetchGenerationApi,
    updateGeneration as updateGenerationApi,
    deleteGeneration as deleteGenerationApi,
    fetchQueue,
    fetchStatus
} from '../api';
import type { WorkflowMeta, Workflow, QueueItem, ServerStatus, GenerationEntry, GenerationSummary, GenerationResultItem } from '../api';

// ── localStorage helpers ──────────────────────────────────────────────
const STORAGE_KEY_WORKFLOWS = 'comfyDashboard:workflows';
const STORAGE_KEY_SELECTED = 'comfyDashboard:selectedId';

export const loadWorkflowsFromStorage = (): WorkflowMeta[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY_WORKFLOWS);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const loadSelectedIdFromStorage = (): string | null => {
    try {
        return localStorage.getItem(STORAGE_KEY_SELECTED);
    } catch {
        return null;
    }
};

export const setSelectedIdToStorage = (id: string | null) => {
    try {
        if (id) {
            localStorage.setItem(STORAGE_KEY_SELECTED, id);
        } else {
            localStorage.removeItem(STORAGE_KEY_SELECTED);
        }
    } catch {
        // ignore
    }
};

/**
 * Keep every workflow collection in the same order as the server list route:
 * newest `modifiedDate` first. The copy prevents local state updates from
 * mutating an array owned by a caller or by a previous React state snapshot.
 */
export const sortWorkflowsByModifiedDate = (workflows: WorkflowMeta[]): WorkflowMeta[] => {
    return [...workflows].sort((a, b) => (b.modifiedDate || '').localeCompare(a.modifiedDate || ''));
};

/**
 * Apply the generation timestamp to one workflow and put that workflow first.
 * The explicit first-position seed guarantees the active workflow wins even
 * when another client supplied a future-dated metadata timestamp. A missing id
 * is retained as a no-op except for normalizing the existing collection.
 */
export const touchWorkflowInList = (
    workflows: WorkflowMeta[],
    workflowId: string,
    modifiedDate: string
): WorkflowMeta[] => {
    const workflow = workflows.find((item) => item.id === workflowId);
    if (!workflow) return sortWorkflowsByModifiedDate(workflows);

    const touched = { ...workflow, modifiedDate };
    const remaining = workflows.filter((item) => item.id !== workflowId);
    return [touched, ...sortWorkflowsByModifiedDate(remaining)];
};

// Debounced write to localStorage for workflows.
let pendingHandle: number | null = null;
export const scheduleSaveWorkflowsToStorage = (workflows: WorkflowMeta[]): void => {
    if (pendingHandle !== null) return;
    const write = () => {
        pendingHandle = null;
        try {
            const incoming = JSON.stringify(workflows);
            const raw = localStorage.getItem(STORAGE_KEY_WORKFLOWS);
            if (raw !== incoming) {
                localStorage.setItem(STORAGE_KEY_WORKFLOWS, incoming);
            }
        } catch {
            // ignore
        }
    };
    if (typeof requestIdleCallback === 'function') {
        pendingHandle = requestIdleCallback(write, { timeout: 2000 });
    } else {
        pendingHandle = setTimeout(write, 0) as unknown as number;
    }
};

// ── Store types ───────────────────────────────────────────────────────

export type DashboardStore = {
    workflows: WorkflowMeta[];
    selectedId: string | null;
    selectedWorkflow: Workflow | null;
    searchQuery: string;
    queue: QueueItem[];
    status: ServerStatus | null;
    generations: GenerationSummary[];
    config: {
        baseUrl: string;
        pollIntervalMs: number;
    };
    loadWarning?: string;
};

type DashboardStoreContextValue = {
    store: DashboardStore;
    setStore: (updater: (prev: DashboardStore) => DashboardStore) => void;
    createWorkflow: (body: { name: string; description?: string; raw: Record<string, unknown> }) => Promise<WorkflowMeta>;
    updateWorkflow: (id: string, body: { name?: string; description?: string; raw?: Record<string, unknown>; tags?: string[] }) => Promise<Workflow>;
    deleteWorkflow: (id: string) => Promise<void>;
    cloneWorkflow: (id: string, rawOverride?: Record<string, unknown>) => Promise<WorkflowMeta>;
    selectWorkflow: (id: string | null) => Promise<void>;
    searchWorkflows: (query: string) => Promise<void>;
    refreshWorkflows: () => Promise<void>;
    refreshQueue: () => Promise<void>;
    refreshStatus: () => Promise<void>;
    refreshGenerations: (workflowId: string) => Promise<void>;
    fetchGeneration: (workflowId: string, generateId: string) => Promise<GenerationEntry>;
    generateWorkflow: (workflowId: string, prompt?: Record<string, unknown>, name?: string) => Promise<GenerationEntry>;
    updateGeneration: (workflowId: string, generateId: string, body: Partial<Pick<GenerationEntry, 'status' | 'result' | 'generatedTime' | 'completedDate' | 'error'>>) => Promise<void>;
    deleteGeneration: (workflowId: string, generateId: string) => Promise<void>;
};

const DEFAULT_CONFIG: DashboardStore['config'] = {
    // Host-aware default from frontend/config.ts: localhost-hosted pages keep
    // API calls on the localhost domain; LAN/domain-hosted pages (and
    // non-browser imports) fall back to the LAN service IP.
    baseUrl: resolveDefaultBaseUrl(),
    // Keep the store's exposed timing metadata aligned with the generation
    // polling hook, whose actual interval is sourced from frontend/config.ts.
    pollIntervalMs: GENERATION_STATUS_POLL_INTERVAL_MS
};

const DashboardStoreContext = createContext<DashboardStoreContextValue | null>(null);

export const DashboardStoreProvider: React.FC<{
    children: React.ReactNode;
    configOverrides?: Partial<DashboardStore['config']>;
    initialStore?: Partial<DashboardStore>;
}> = ({ children, configOverrides, initialStore }) => {
    const [store, setStoreState] = useState<DashboardStore>(() => ({
        workflows: initialStore?.workflows ?? loadWorkflowsFromStorage(),
        selectedId: initialStore?.selectedId ?? loadSelectedIdFromStorage(),
        selectedWorkflow: initialStore?.selectedWorkflow ?? null,
        searchQuery: initialStore?.searchQuery ?? '',
        queue: initialStore?.queue ?? [],
        status: initialStore?.status ?? null,
        generations: initialStore?.generations ?? [],
        config: { ...DEFAULT_CONFIG, ...configOverrides }
    }));

    const setStore = useCallback(
        (updater: (prev: DashboardStore) => DashboardStore) => setStoreState((prev) => updater(prev)),
        []
    );

    // Persist selectedId whenever it changes.
    useEffect(() => {
        setSelectedIdToStorage(store.selectedId);
    }, [store.selectedId]);

    // Auto-persist workflows to localStorage.
    const didHydrateRef = useRef(false);
    useEffect(() => {
        if (!didHydrateRef.current) {
            didHydrateRef.current = true;
            return;
        }
        scheduleSaveWorkflowsToStorage(store.workflows);
    }, [store.workflows]);

    const refreshWorkflows = useCallback(async () => {
        try {
            const { workflows } = await fetchWorkflows(`${store.config.baseUrl}/workflows`);
            setStore((prev) => ({
                ...prev,
                workflows: sortWorkflowsByModifiedDate(workflows),
                loadWarning: undefined
            }));
        } catch (err) {
            setStore((prev) => ({
                ...prev,
                loadWarning: `Could not reach server: ${err instanceof Error ? err.message : String(err)}`
            }));
        }
    }, [store.config.baseUrl, setStore]);

    const refreshQueue = useCallback(async () => {
        try {
            const { queue } = await fetchQueue(`${store.config.baseUrl}/queue`);
            setStore((prev) => ({ ...prev, queue }));
        } catch {
            // Queue fetch failures are non-fatal — keep stale data.
        }
    }, [store.config.baseUrl, setStore]);

    const refreshStatus = useCallback(async () => {
        try {
            const status = await fetchStatus(`${store.config.baseUrl}/status`);
            setStore((prev) => ({ ...prev, status }));
        } catch {
            // Status failures are non-fatal.
        }
    }, [store.config.baseUrl, setStore]);

    const createWorkflow = useCallback(
        async (body: { name: string; description?: string; raw: Record<string, unknown> }) => {
            const { workflow } = await createWorkflowApi(`${store.config.baseUrl}/workflows`, body);
            setStore((prev) => ({
                ...prev,
                workflows: sortWorkflowsByModifiedDate([workflow, ...prev.workflows])
            }));
            return workflow;
        },
        [store.config.baseUrl, setStore]
    );

    const updateWorkflow = useCallback(
        async (id: string, body: { name?: string; description?: string; raw?: Record<string, unknown>; tags?: string[] }) => {
            const { workflow } = await updateWorkflowApi(`${store.config.baseUrl}/workflows`, id, body);
            setStore((prev) => ({
                ...prev,
                workflows: sortWorkflowsByModifiedDate(
                    prev.workflows.map((w) =>
                        w.id === id
                            ? {
                                  id: workflow.id,
                                  name: workflow.name,
                                  description: workflow.description,
                                  nodeCount: workflow.nodeCount,
                                  createdDate: workflow.createdDate,
                                  modifiedDate: workflow.modifiedDate,
                                  tags: workflow.tags,
                                  inputFields: workflow.inputFields
                              }
                            : w
                    )
                ),
                selectedWorkflow: prev.selectedId === id ? workflow : prev.selectedWorkflow
            }));
            return workflow;
        },
        [store.config.baseUrl, setStore]
    );

    const deleteWorkflow = useCallback(
        async (id: string) => {
            await deleteWorkflowApi(`${store.config.baseUrl}/workflows`, id);
            setStore((prev) => ({
                ...prev,
                workflows: prev.workflows.filter((w) => w.id !== id),
                selectedId: prev.selectedId === id ? null : prev.selectedId,
                selectedWorkflow: prev.selectedId === id ? null : prev.selectedWorkflow
            }));
        },
        [store.config.baseUrl, setStore]
    );

    const cloneWorkflow = useCallback(
        async (id: string, rawOverride?: Record<string, unknown>) => {
            // Fetch the source workflow for its name/description. The
            // cloned raw comes from rawOverride when given — the editor
            // passes its current page state (unsaved edits included) so the
            // clone mirrors what's on screen; otherwise the stored json.
            const { workflow: full } = await fetchWorkflow(`${store.config.baseUrl}/workflows`, id);
            const { workflow: cloned } = await createWorkflowApi(`${store.config.baseUrl}/workflows`, {
                name: `${full.name} (Copy)`,
                description: full.description,
                raw: rawOverride ?? full.raw
            });
            setStore((prev) => ({
                ...prev,
                workflows: sortWorkflowsByModifiedDate([cloned, ...prev.workflows])
            }));
            return cloned;
        },
        [store.config.baseUrl, setStore]
    );

    const selectWorkflow = useCallback(
        async (id: string | null) => {
            setStore((prev) => ({ ...prev, selectedId: id }));
            if (!id) {
                setStore((prev) => ({ ...prev, selectedWorkflow: null }));
                return;
            }
            try {
                const { workflow } = await fetchWorkflow(`${store.config.baseUrl}/workflows`, id);
                setStore((prev) => ({ ...prev, selectedWorkflow: workflow }));
            } catch {
                // Failed to load workflow detail
            }
        },
        [store.config.baseUrl, setStore]
    );

    const searchWorkflows = useCallback(
        async (query: string) => {
            setStore((prev) => ({ ...prev, searchQuery: query }));
            try {
                const { workflows } = await fetchWorkflows(`${store.config.baseUrl}/workflows`, { query });
                setStore((prev) => ({
                    ...prev,
                    workflows: sortWorkflowsByModifiedDate(workflows),
                    loadWarning: undefined
                }));
            } catch {
                // Search failures are non-fatal
            }
        },
        [store.config.baseUrl, setStore]
    );

    const generateWorkflow = useCallback(
        async (workflowId: string, prompt?: Record<string, unknown>, name?: string) => {
            const { generation } = await generateWorkflowApi(`${store.config.baseUrl}`, workflowId, prompt, name);
            // The server updates meta.modifiedDate when this generation file is
            // created. Mirror that timestamp locally immediately so the active
            // workflow moves to the top without waiting for another list fetch.
            setStore((prev) => ({
                ...prev,
                workflows: touchWorkflowInList(prev.workflows, workflowId, generation.createdDate)
            }));
            // Refresh generations after creating one
            try {
                const { generations } = await fetchGenerationsApi(`${store.config.baseUrl}`, workflowId);
                setStore((prev) => ({ ...prev, generations }));
            } catch {
                // Non-fatal
            }
            return generation;
        },
        [store.config.baseUrl, setStore]
    );

    const refreshGenerations = useCallback(async (workflowId: string) => {
        try {
            const { generations } = await fetchGenerationsApi(`${store.config.baseUrl}`, workflowId);
            setStore((prev) => ({ ...prev, generations }));
        } catch {
            // Non-fatal
        }
    }, [store.config.baseUrl, setStore]);

    // Fetch a single generation's full data (prompt + result). The list
    // endpoint returns lightweight summaries, and result media streams via
    // generationResultUrl(), so the remaining use is when an agent needs
    // the snapshotted prompt to submit.
    const fetchGeneration = useCallback(async (workflowId: string, generateId: string): Promise<GenerationEntry> => {
        const { generation } = await fetchGenerationApi(`${store.config.baseUrl}`, workflowId, generateId);
        return generation;
    }, [store.config.baseUrl]);

    const updateGeneration = useCallback(async (
        workflowId: string,
        generateId: string,
        body: Partial<Pick<GenerationEntry, 'status' | 'result' | 'generatedTime' | 'completedDate' | 'error'>>
    ) => {
        await updateGenerationApi(`${store.config.baseUrl}`, workflowId, generateId, body);
        // Refresh generations after update
        try {
            const { generations } = await fetchGenerationsApi(`${store.config.baseUrl}`, workflowId);
            setStore((prev) => ({ ...prev, generations }));
        } catch {
            // Non-fatal
        }
    }, [store.config.baseUrl, setStore]);

    // Delete a generation — drop it from the local list right away, then
    // confirm with a refresh (the delete also removes the .log trail on
    // the server; a still-processing run is NOT cancelled, it just stops
    // updating the gone file).
    const deleteGeneration = useCallback(async (workflowId: string, generateId: string) => {
        await deleteGenerationApi(`${store.config.baseUrl}`, workflowId, generateId);
        setStore((prev) => ({ ...prev, generations: prev.generations.filter((g) => g.id !== generateId) }));
        try {
            const { generations } = await fetchGenerationsApi(`${store.config.baseUrl}`, workflowId);
            setStore((prev) => ({ ...prev, generations }));
        } catch {
            // Non-fatal — the local list already dropped the entry.
        }
    }, [store.config.baseUrl, setStore]);

    return (
        <DashboardStoreContext.Provider value={{
            store,
            setStore,
            createWorkflow,
            updateWorkflow,
            deleteWorkflow,
            cloneWorkflow,
            selectWorkflow,
            searchWorkflows,
            refreshWorkflows,
            refreshQueue,
            refreshStatus,
            refreshGenerations,
            fetchGeneration,
            generateWorkflow,
            updateGeneration,
            deleteGeneration
        }}>
            {children}
        </DashboardStoreContext.Provider>
    );
};

export function useDashboardStore(): DashboardStoreContextValue {
    const ctx = useContext(DashboardStoreContext);
    if (!ctx) {
        throw new Error('useDashboardStore must be used inside <DashboardStoreProvider>');
    }
    return ctx;
}
