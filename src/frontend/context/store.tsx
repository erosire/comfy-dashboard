// Context store for the comfy-dashboard.
//
// Manages the reactive state for workflows, queue, and server status.
// Uses plain React context + useState (same pattern as the story-generator).

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import {
    deleteWorkflow as deleteWorkflowApi,
    fetchWorkflows,
    fetchWorkflow,
    createWorkflow as createWorkflowApi,
    updateWorkflow as updateWorkflowApi,
    fetchQueue,
    fetchStatus
} from '../api';
import type { WorkflowMeta, Workflow, QueueItem, ServerStatus } from '../api';

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
    cloneWorkflow: (id: string) => Promise<WorkflowMeta>;
    selectWorkflow: (id: string | null) => Promise<void>;
    searchWorkflows: (query: string) => Promise<void>;
    refreshWorkflows: () => Promise<void>;
    refreshQueue: () => Promise<void>;
    refreshStatus: () => Promise<void>;
};

const DEFAULT_CONFIG: DashboardStore['config'] = {
    baseUrl: 'http://192.168.8.128:5000/v1/comfy',
    pollIntervalMs: 5000
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
            setStore((prev) => ({ ...prev, workflows, loadWarning: undefined }));
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
                workflows: [workflow, ...prev.workflows]
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
                workflows: prev.workflows.map((w) =>
                    w.id === id
                        ? {
                              id: workflow.id,
                              name: workflow.name,
                              description: workflow.description,
                              nodeCount: workflow.nodeCount,
                              createdDate: workflow.createdDate,
                              modifiedDate: workflow.modifiedDate,
                              tags: workflow.tags
                          }
                        : w
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
        async (id: string) => {
            // Fetch the full workflow, then create a new one with "(Copy)" suffix
            const { workflow: full } = await fetchWorkflow(`${store.config.baseUrl}/workflows`, id);
            const { workflow: cloned } = await createWorkflowApi(`${store.config.baseUrl}/workflows`, {
                name: `${full.name} (Copy)`,
                description: full.description,
                raw: full.raw
            });
            setStore((prev) => ({
                ...prev,
                workflows: [cloned, ...prev.workflows]
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
                setStore((prev) => ({ ...prev, workflows, loadWarning: undefined }));
            } catch {
                // Search failures are non-fatal
            }
        },
        [store.config.baseUrl, setStore]
    );

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
            refreshStatus
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
