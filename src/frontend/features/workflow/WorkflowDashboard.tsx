// WorkflowDashboard — Beam cloud workflow runner.
//
// Two-panel layout:
//   Left sidebar: saved workflows list (from store) with search
//   Right content: workflow editor (drop, edit, submit)
//
// Integrates with DashboardStore for CRUD operations on workflows.
// Manages pod lifecycle and prompt execution for cloud runs.
//
// Originally CloudTab.tsx — split into the components/ folder (standalone
// UI pieces) and components/utils/ (hooks & logic); everything is barreled
// upwards through ./components and imported here.

import React from 'react';
import type { WorkflowMeta } from '../../api';
import { ComfyDashboard } from '../../components';
import { useDashboardStore } from '../../context';
import {
    DashboardHeaderControls,
    DeleteWorkflowDialog,
    FooterActions,
    RenameWorkflowDialog,
    ResultViewer,
    WorkflowEditorContent,
    WorkflowSidebar,
    useDebouncedSearch,
    useGenerationsPolling,
    useMediaQuery,
    usePods,
    useResultViewer,
    useSpawnAgent,
    useWorkflowActions,
    useWorkflowEditor
} from './components';

export type WorkflowDashboardProps = {
    baseUrl?: string;
};

export const WorkflowDashboard: React.FC<WorkflowDashboardProps> = React.memo(
    ({ baseUrl = 'http://192.168.8.128:5000/v1/comfy' }) => {
        const {
            store,
            createWorkflow,
            updateWorkflow,
            deleteWorkflow,
            cloneWorkflow,
            selectWorkflow,
            searchWorkflows,
            refreshGenerations,
            fetchGeneration,
            generateWorkflow,
            updateGeneration
        } = useDashboardStore();

        // ── Editor state (node tree, raw json, prompt fields, tabs) ──

        const editingWorkflowId = store.selectedId;
        const editor = useWorkflowEditor({
            selectedWorkflow: store.selectedWorkflow,
            editingWorkflowId,
            createWorkflow,
            updateWorkflow,
            selectWorkflow
        });
        // Determine if we're editing a saved workflow (loaded from sidebar)
        const isEditingSaved = editingWorkflowId !== null && editor.rawJson !== null;

        // ── Pods (lifecycle, heartbeat, generation sync) ─────────────

        const { pods, handleGenerate, handlePodGenerate } = usePods({
            baseUrl,
            nodes: editor.nodes,
            editingWorkflowId,
            generations: store.generations,
            generateWorkflow
        });

        // ── Spawn agent (pod that runs all pending generations) ──────

        const { agentRunning, agentCount, executingNodeId, handleSpawnAgent } = useSpawnAgent({
            baseUrl,
            generations: store.generations,
            editingWorkflowId,
            updateGeneration,
            refreshGenerations,
            fetchGeneration
        });

        // ── Result viewer (image/video modal) ─────────────────────────

        const viewer = useResultViewer({
            selectedId: store.selectedId,
            generations: store.generations,
            baseUrl: store.config.baseUrl
        });

        // ── Workflow actions (clone / rename / delete) ────────────────

        const actions = useWorkflowActions({
            editingWorkflowId,
            selectedWorkflow: store.selectedWorkflow,
            cloneWorkflow,
            deleteWorkflow,
            updateWorkflow,
            selectWorkflow,
            resetEditor: editor.resetEditor
        });

        // ── Sidebar & search ──────────────────────────────────────────

        // Mobile breakpoint — matches ComfyDashboard's (max-width: 767px).
        // Drives all JS-side responsive behavior (viewer chrome, editor padding).
        const isMobile = useMediaQuery('(max-width: 767px)');

        const [sidebarOpen, setSidebarOpen] = React.useState(() => {
            if (typeof window !== 'undefined' && window.matchMedia) {
                return window.matchMedia('(min-width: 768px)').matches;
            }
            return true;
        });
        const toggleSidebar = React.useCallback(() => setSidebarOpen((prev) => !prev), []);

        const { searchText, handleSearchChange } = useDebouncedSearch(store.searchQuery, searchWorkflows);

        // Poll generations for the selected workflow
        useGenerationsPolling(editingWorkflowId, refreshGenerations);

        // ── Load a saved workflow from sidebar ───────────────────────────
        // selectWorkflow loads the full workflow into store.selectedWorkflow;
        // the editor hook parses its raw JSON into nodes.

        const handleLoadWorkflow = React.useCallback(
            (wf: WorkflowMeta) => {
                selectWorkflow(wf.id);
            },
            [selectWorkflow]
        );

        // ── Layout ───────────────────────────────────────────────────────

        return (
            <>
                <ComfyDashboard
                    sidebarOpen={sidebarOpen}
                    onOverlayClick={toggleSidebar}
                    headerControls={
                        <DashboardHeaderControls
                            onToggleSidebar={toggleSidebar}
                            title={
                                isEditingSaved && store.selectedWorkflow
                                    ? store.selectedWorkflow.name
                                    : 'Comfy Dashboard'
                            }
                            titleClickable={isEditingSaved}
                            onTitleClick={actions.openRename}
                            loadWarning={store.loadWarning}
                            agentCount={agentCount}
                            agentRunning={agentRunning}
                            onSpawnAgent={handleSpawnAgent}
                        />
                    }
                    sidebar={
                        <WorkflowSidebar
                            workflows={store.workflows}
                            selectedId={editingWorkflowId}
                            searchText={searchText}
                            onSearchChange={handleSearchChange}
                            onSelect={handleLoadWorkflow}
                            scrollSignal={pods}
                        />
                    }
                    content={
                        <WorkflowEditorContent
                            nodes={editor.nodes}
                            dragOver={editor.dragOver}
                            onDrop={editor.handleDrop}
                            onDragOver={editor.handleDragOver}
                            onDragLeave={editor.handleDragLeave}
                            isEditingSaved={isEditingSaved}
                            selectedWorkflowName={store.selectedWorkflow?.name}
                            isMobile={isMobile}
                            contentTab={editor.contentTab}
                            onSelectTab={editor.setContentTab}
                            promptFields={editor.promptFields}
                            promptEntries={editor.promptEntries}
                            executingNodeId={executingNodeId}
                            updateNodeWidget={editor.updateNodeWidget}
                            toggleNodeBypass={editor.toggleNodeBypass}
                            togglePromptField={editor.togglePromptField}
                            onCopyJson={editor.handleCopyJson}
                            onClone={actions.handleClone}
                            generations={store.generations}
                            onOpenViewer={viewer.openViewer}
                            saving={editor.saving}
                            onSave={editor.handleSave}
                            onDelete={actions.handleDelete}
                        />
                    }
                    footer={
                        <FooterActions
                            pods={pods}
                            nodeCount={editor.nodes.length}
                            onPodGenerate={handlePodGenerate}
                            onGenerate={handleGenerate}
                        />
                    }
                />

                {/* Rename dialog */}
                {actions.renameOpen && (
                    <RenameWorkflowDialog
                        value={actions.renameValue}
                        onChange={actions.setRenameValue}
                        onSubmit={actions.submitRename}
                        onCancel={actions.cancelRename}
                    />
                )}

                {/* Delete confirmation dialog — guards against accidental clicks */}
                {actions.deleteConfirmOpen && (
                    <DeleteWorkflowDialog
                        workflowName={store.selectedWorkflow?.name}
                        onConfirm={actions.confirmDelete}
                        onCancel={actions.cancelDelete}
                    />
                )}

                {/* ── Image/Video Viewer Modal ──────────────────────────── */}
                {viewer.viewerOpen && viewer.viewerEntries.length > 0 && (
                    <ResultViewer
                        isMobile={isMobile}
                        entriesCount={viewer.viewerEntries.length}
                        current={viewer.viewerCurrent}
                        currentIndex={viewer.viewerIndex}
                        mediaUrl={viewer.viewerMediaUrl}
                        onClose={viewer.closeViewer}
                        onNavigate={viewer.navigateViewer}
                    />
                )}
            </>
        );
    }
);
