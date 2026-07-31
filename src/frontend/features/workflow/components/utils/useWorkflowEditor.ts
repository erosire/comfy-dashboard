// Workflow editor state — owns the parsed node tree, the raw JSON backing
// it, the PROMPT-tab field selection, the content tab switcher, and all
// load / drop / save / copy flows.
//
// The editor tree (via useNodeTree) is the source of truth while the user
// edits; both Generate and Save build from it, never from rawJson.
//
// Extracted from the original CloudTab.tsx — every behaviour is identical:
//   - selectedWorkflow → parse → restore prompt fields (+ content tab)
//   - drop a .json file → parse + auto-save with the filename as the name
//   - Save → widget edits + prompt field selection persisted into the json
//   - Copy → modern Clipboard API with a textarea/execCommand fallback
//   - resetEditor → wipe everything (used after a successful Delete)

import React from 'react';
import type { Workflow, WorkflowMeta } from '../../../../api';
import type { UINode } from '../../../../nodes/node-type';
import type { EditorContentTab, PromptWidgetRef } from './types';
import { parseWorkflowJson } from './workflow-parser';
import { renumberNodes, sortNodesDeep } from './workflow-sort';
import { applyWidgetEditsToRaw } from './workflow-serialize';
import { collectPromptWidgets, promptWidgetKey, readSavedPromptFields, writePromptFieldsToRaw } from './prompt-fields';
import { useNodeTree } from './useNodeTree';

export type UseWorkflowEditorParams = {
    /**
     * The workflow currently loaded for editing (store.selectedWorkflow)
     * — changes re-parse its raw JSON into the node tree.
     */
    selectedWorkflow: Workflow | null;
    /** Id of the workflow being edited (store.selectedId). */
    editingWorkflowId: string | null;
    createWorkflow: (body: {
        name: string;
        description?: string;
        raw: Record<string, unknown>;
    }) => Promise<WorkflowMeta>;
    updateWorkflow: (
        id: string,
        body: { name?: string; description?: string; raw?: Record<string, unknown>; tags?: string[] }
    ) => Promise<Workflow>;
    selectWorkflow: (id: string | null) => Promise<void>;
};

export function useWorkflowEditor({
    selectedWorkflow,
    editingWorkflowId,
    createWorkflow,
    updateWorkflow,
    selectWorkflow
}: UseWorkflowEditorParams) {
    const { nodes, setNodes, updateNodeWidget, toggleNodeBypass } = useNodeTree();
    const [rawJson, setRawJson] = React.useState<Record<string, unknown> | null>(null);
    const [fileName, setFileName] = React.useState('');
    const [dragOver, setDragOver] = React.useState(false);
    // Content area switcher — "json" shows the workflow node layout;
    // "prompt" shows the quick-edit fields picked via label clicks.
    const [contentTab, setContentTab] = React.useState<EditorContentTab>('json');
    // Keys of widgets promoted into the PROMPT quick-edit tab. Clicking a
    // widget label in the JSON layout toggles its key here. Persisted into
    // the workflow json (extra.promptFields) via Save so it survives reload.
    const [promptFields, setPromptFields] = React.useState<Set<string>>(new Set());
    const [saving, setSaving] = React.useState(false);

    // When selectedWorkflow changes, parse its raw JSON into nodes.
    //
    // Pods are intentionally NOT reset here: a pod is an independent Beam
    // cloud instance — switching workflows must not destroy it. The pod
    // buttons (and their monotonic pod-number counter) persist across
    // workflow loads, so a pod spawned while editing one workflow can be
    // reused to queue a generation on any other workflow.
    React.useEffect(() => {
        if (selectedWorkflow && selectedWorkflow.raw) {
            const parsed = renumberNodes(sortNodesDeep(parseWorkflowJson(selectedWorkflow.raw)));
            setRawJson(selectedWorkflow.raw);
            setNodes(parsed);
            setFileName(`${selectedWorkflow.name}.json`);
            // Restore the saved PROMPT field selection; with fields present
            // the PROMPT tab becomes the active view.
            const fields = readSavedPromptFields(selectedWorkflow.raw, parsed);
            setPromptFields(fields);
            setContentTab(fields.size > 0 ? 'prompt' : 'json');
        }
    }, [selectedWorkflow, setNodes]);

    // ── Auto-save workflow on drop ──────────────────────────────────

    const autoSaveWorkflow = React.useCallback(
        async (raw: Record<string, unknown>, name: string) => {
            try {
                const created = await createWorkflow({
                    name,
                    raw
                });
                selectWorkflow(created.id);
            } catch (err: any) {
                alert(`Failed to auto-save: ${err.message ?? String(err)}`);
            }
        },
        [createWorkflow, selectWorkflow]
    );

    // ── File handling ────────────────────────────────────────────────

    const handleFile = React.useCallback(
        (file: File) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(reader.result as string) as Record<string, unknown>;
                    const uiNodes = renumberNodes(sortNodesDeep(parseWorkflowJson(parsed)));
                    setRawJson(parsed);
                    setNodes(uiNodes);
                    const name = file.name.replace(/\.json$/i, '') || 'Untitled Workflow';
                    setFileName(file.name);
                    // Auto-save the workflow with the filename as the name.
                    // Pods are independent of workflows — do not reset them.
                    autoSaveWorkflow(parsed, name);
                    // Dropped files may carry a saved PROMPT selection too.
                    const fields = readSavedPromptFields(parsed, uiNodes);
                    setPromptFields(fields);
                    setContentTab(fields.size > 0 ? 'prompt' : 'json');
                } catch {
                    alert('Invalid JSON file');
                }
            };
            reader.readAsText(file);
        },
        [autoSaveWorkflow, setNodes]
    );

    const handleDrop = React.useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
        },
        [handleFile]
    );

    const handleDragOver = React.useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
    }, []);

    const handleDragLeave = React.useCallback((e: React.DragEvent) => {
        const related = e.relatedTarget as HTMLElement | null;
        if (related && e.currentTarget.contains(related)) return;
        setDragOver(false);
    }, []);

    // ── PROMPT tab field toggling ──────────────────────────────────────
    // Clicking a widget label (in either tab) toggles the field in/out of
    // the PROMPT quick-edit list. Both tabs bind to the same tree state, so
    // edits on one side are instantly reflected on the other.

    const togglePromptField = React.useCallback((node: UINode, widgetIdx: number) => {
        const widget = node.widgets.find((w) => w.index === widgetIdx);
        if (!widget) return;
        const key = promptWidgetKey(node, widget);
        setPromptFields((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);

    /** Selected fields resolved against the current tree, in display order. */
    const promptEntries = React.useMemo(() => {
        const all = collectPromptWidgets(nodes);
        const refs: PromptWidgetRef[] = [];
        for (const [key, ref] of all) {
            if (promptFields.has(key)) refs.push(ref);
        }
        return refs;
    }, [nodes, promptFields]);

    // The PROMPT tab only makes sense with something in it — fall back to
    // JSON when the last field is removed while PROMPT is active.
    React.useEffect(() => {
        if (contentTab === 'prompt' && promptFields.size === 0) {
            setContentTab('json');
        }
    }, [contentTab, promptFields]);

    // ── Copy JSON to clipboard ───────────────────────────────────────

    const handleCopyJson = React.useCallback(async () => {
        if (!rawJson) return;
        const text = JSON.stringify(rawJson, null, 2);
        try {
            // Try modern Clipboard API first (requires secure context: HTTPS or localhost)
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return;
            }
        } catch {
            // Fall through to legacy approach
        }
        // Fallback: temporary textarea + execCommand (works over plain HTTP)
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        } catch {
            alert('Failed to copy to clipboard');
        }
    }, [rawJson]);

    // ── Save workflow edits ────────────────────────────────────────────
    // Persist the editor tree's widget edits back into the stored workflow
    // json (the tree — not rawJson — holds the user's edits).

    const handleSave = React.useCallback(async () => {
        if (!editingWorkflowId || !rawJson || saving) return;
        setSaving(true);
        try {
            // Widget edits AND the PROMPT field selection both persist into
            // the stored json (widget values into widgets_values, the field
            // selection into extra.promptFields).
            const updatedRaw = writePromptFieldsToRaw(applyWidgetEditsToRaw(rawJson, nodes), promptFields);
            await updateWorkflow(editingWorkflowId, { raw: updatedRaw });
            // Keep the local copy in sync so a subsequent Save builds from it.
            setRawJson(updatedRaw);
        } catch (err: any) {
            alert(`Failed to save: ${err.message ?? String(err)}`);
        } finally {
            setSaving(false);
        }
    }, [editingWorkflowId, rawJson, nodes, promptFields, saving, updateWorkflow]);

    // ── Reset (after Delete) ─────────────────────────────────────────
    // Pods are independent Beam cloud instances — deleting a workflow must
    // not destroy them; they remain usable with whichever workflow loads
    // next, so this only clears the editor state.

    const resetEditor = React.useCallback(() => {
        setNodes([]);
        setRawJson(null);
        setFileName('');
        setPromptFields(new Set());
        setContentTab('json');
    }, [setNodes]);

    return {
        nodes,
        rawJson,
        fileName,
        dragOver,
        contentTab,
        setContentTab,
        promptFields,
        promptEntries,
        saving,
        updateNodeWidget,
        toggleNodeBypass,
        togglePromptField,
        handleDrop,
        handleDragOver,
        handleDragLeave,
        handleCopyJson,
        handleSave,
        resetEditor
    };
}
