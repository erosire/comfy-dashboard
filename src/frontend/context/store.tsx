// Context store for the comfy-dashboard.
//
// Manages the reactive state for workflows, queue, and server status.
// Uses plain React context + useState (same pattern as the story-generator).

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { deleteWorkflow as deleteWorkflowApi, fetchWorkflows, fetchQueue, fetchStatus } from '../api';
import type { WorkflowMeta, QueueItem, ServerStatus } from '../api';

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
    deleteWorkflow: (id: string) => Promise<void>;
    refreshWorkflows: () => Promise<void>;
    refreshQueue: () => Promise<void>;
    refreshStatus: () => Promise<void>;
};

const DEFAULT_CONFIG: DashboardStore['config'] = {
    baseUrl: 'http://127.0.0.1:8188/api',
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

    const deleteWorkflow = useCallback(
        async (id: string) => {
            await deleteWorkflowApi(`${store.config.baseUrl}/workflows`, id);
            setStore((prev) => ({
                ...prev,
                workflows: prev.workflows.filter((w) => w.id !== id),
                selectedId: prev.selectedId === id ? null : prev.selectedId
            }));
        },
        [store.config.baseUrl, setStore]
    );

    return (
        <DashboardStoreContext.Provider value={{ store, setStore, deleteWorkflow, refreshWorkflows, refreshQueue, refreshStatus }}>
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
