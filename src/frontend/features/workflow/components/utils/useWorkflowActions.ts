// Workflow action flows — Clone, Rename, Delete, and per-generation Delete
// (all destructive ones with confirmation).
//
// Delete is destructive, so the button only opens a confirmation dialog —
// an accidental click can never wipe a workflow. Custom modals are used
// instead of window.confirm, which some embedded webviews silently
// suppress.
//
// Extracted from the original CloudTab.tsx.

import React from 'react';
import type { Workflow, WorkflowMeta } from '../../../../api';

export type UseWorkflowActionsParams = {
    /** Id of the workflow being edited (store.selectedId). */
    editingWorkflowId: string | null;
    /** The loaded workflow (store.selectedWorkflow) — rename seeds its name. */
    selectedWorkflow: Workflow | null;
    cloneWorkflow: (id: string, rawOverride?: Record<string, unknown>) => Promise<WorkflowMeta>;
    /** Snapshots the editor's current page state (widget edits + PROMPT
        field selection, saved or not) — the clone is built from it, so
        Clone mirrors exactly what's on screen. Returns null with nothing
        loaded; the clone then falls back to the stored json. */
    getCurrentRaw: () => Record<string, unknown> | null;
    deleteWorkflow: (id: string) => Promise<void>;
    /** Deletes a generation snapshot of the workflow being edited. */
    deleteGeneration: (workflowId: string, generateId: string) => Promise<void>;
    updateWorkflow: (
        id: string,
        body: { name?: string; description?: string; raw?: Record<string, unknown>; tags?: string[] }
    ) => Promise<Workflow>;
    selectWorkflow: (id: string | null) => Promise<void>;
    /** Clears the editor tree/json after a successful delete. */
    resetEditor: () => void;
};

export function useWorkflowActions({
    editingWorkflowId,
    selectedWorkflow,
    cloneWorkflow,
    getCurrentRaw,
    deleteWorkflow,
    deleteGeneration,
    updateWorkflow,
    selectWorkflow,
    resetEditor
}: UseWorkflowActionsParams) {
    const [renameOpen, setRenameOpen] = React.useState(false);
    const [renameValue, setRenameValue] = React.useState('');
    const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
    // Id of the generation awaiting delete confirmation (OUTPUT tab) —
    // null when no per-generation delete dialog is open.
    const [deleteGenerationTarget, setDeleteGenerationTarget] = React.useState<string | null>(null);

    // ── Clone workflow ───────────────────────────────────────────────
    // The clone is built from the current page state (unsaved edits
    // included), NOT from the stored json — cloning keeps every change
    // made on this page even if it was never saved.

    const handleClone = React.useCallback(async () => {
        if (!editingWorkflowId) return;
        try {
            const cloned = await cloneWorkflow(editingWorkflowId, getCurrentRaw() ?? undefined);
            // Select the clone
            selectWorkflow(cloned.id);
        } catch (err: any) {
            alert(`Failed to clone: ${err.message ?? String(err)}`);
        }
    }, [editingWorkflowId, cloneWorkflow, getCurrentRaw, selectWorkflow]);

    // ── Delete workflow ──────────────────────────────────────────────

    const handleDelete = React.useCallback(() => {
        if (!editingWorkflowId) return;
        setDeleteConfirmOpen(true);
    }, [editingWorkflowId]);

    const confirmDelete = React.useCallback(async () => {
        if (!editingWorkflowId) return;
        setDeleteConfirmOpen(false);
        try {
            await deleteWorkflow(editingWorkflowId);
            // Clear editor. Pods are independent Beam cloud instances —
            // deleting a workflow must not destroy them; they remain usable
            // with whichever workflow is loaded next.
            resetEditor();
        } catch (err: any) {
            alert(`Failed to delete: ${err.message ?? String(err)}`);
        }
    }, [editingWorkflowId, deleteWorkflow, resetEditor]);

    const cancelDelete = React.useCallback(() => setDeleteConfirmOpen(false), []);

    // ── Delete generation ────────────────────────────────────────────
    // The ✕ on an OUTPUT-tab generation asks first (confirmation dialog);
    // only confirm calls the server. A still-processing generation stops
    // being recorded but keeps running on its pod — see the API docs.

    const handleDeleteGeneration = React.useCallback((generateId: string) => {
        setDeleteGenerationTarget(generateId);
    }, []);

    const confirmDeleteGeneration = React.useCallback(async () => {
        if (!editingWorkflowId || !deleteGenerationTarget) return;
        setDeleteGenerationTarget(null);
        try {
            await deleteGeneration(editingWorkflowId, deleteGenerationTarget);
        } catch (err: any) {
            alert(`Failed to delete generation: ${err.message ?? String(err)}`);
        }
    }, [editingWorkflowId, deleteGenerationTarget, deleteGeneration]);

    const cancelDeleteGeneration = React.useCallback(() => setDeleteGenerationTarget(null), []);

    // ── Rename workflow ────────────────────────────────────────────

    const openRename = React.useCallback(() => {
        if (!editingWorkflowId || !selectedWorkflow) return;
        setRenameValue(selectedWorkflow.name);
        setRenameOpen(true);
    }, [editingWorkflowId, selectedWorkflow]);

    const submitRename = React.useCallback(async () => {
        if (!editingWorkflowId) return;
        const trimmed = renameValue.trim();
        if (!trimmed) return;
        try {
            await updateWorkflow(editingWorkflowId, { name: trimmed });
            setRenameOpen(false);
        } catch (err: any) {
            alert(`Failed to rename: ${err.message ?? String(err)}`);
        }
    }, [editingWorkflowId, renameValue, updateWorkflow]);

    const cancelRename = React.useCallback(() => setRenameOpen(false), []);

    return {
        handleClone,
        renameOpen,
        renameValue,
        setRenameValue,
        openRename,
        submitRename,
        cancelRename,
        deleteConfirmOpen,
        handleDelete,
        confirmDelete,
        cancelDelete,
        deleteGenerationTarget,
        handleDeleteGeneration,
        confirmDeleteGeneration,
        cancelDeleteGeneration
    };
}
