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
import { generationResultUrl } from '../../api';
import { ComfyDashboard } from '../../components';
import { useDashboardStore } from '../../context';
import {
    DashboardHeaderControls,
    DeleteGenerationDialog,
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
    useWorkflowEditor,
    workflowToApiPrompt,
    type OutputViewMode,
    type PodEntry
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
            updateGeneration,
            deleteGeneration
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
            workflowName: store.selectedWorkflow?.name ?? null,
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

        // ── Viewer rerun / create-workflow actions ────────────────────
        // The OUTPUT list carries lightweight generation summaries — the
        // snapshotted API prompt (what Generate + pod buttons re-submit,
        // and what "Create Workflow" turns into a new workflow) is fetched
        // on demand and cached per generation id while the workflow stays
        // selected, so navigating back and forth never refetches.

        const viewerPromptCacheRef = React.useRef<Map<string, Record<string, unknown>>>(new Map());
        const [viewerActionBusy, setViewerActionBusy] = React.useState(false);

        // Cached prompts belong to the currently loaded workflow.
        React.useEffect(() => {
            viewerPromptCacheRef.current.clear();
        }, [editingWorkflowId]);

        const getViewerGenerationPrompt = React.useCallback(
            async (generationId: string): Promise<Record<string, unknown> | null> => {
                const cached = viewerPromptCacheRef.current.get(generationId);
                if (cached) return cached;
                if (!editingWorkflowId) return null;
                const full = await fetchGeneration(editingWorkflowId, generationId);
                // Generation prompts are stored as API prompts already;
                // workflowToApiPrompt is idempotent for dict-shaped input.
                const prompt = workflowToApiPrompt(full.prompt);
                viewerPromptCacheRef.current.set(generationId, prompt);
                return prompt;
            },
            [editingWorkflowId, fetchGeneration]
        );

        const handleViewerGenerate = React.useCallback(async () => {
            const generationId = viewer.viewerCurrent?.generationId;
            if (!generationId || viewerActionBusy) return;
            setViewerActionBusy(true);
            try {
                const prompt = await getViewerGenerationPrompt(generationId);
                // Fire and forget — the spawned "#N" button reports state.
                if (prompt) void handleGenerate(prompt);
            } catch (err: any) {
                alert(`Failed to regenerate: ${err.message ?? String(err)}`);
            } finally {
                setViewerActionBusy(false);
            }
        }, [viewer.viewerCurrent, viewerActionBusy, getViewerGenerationPrompt, handleGenerate]);

        const handleViewerPodGenerate = React.useCallback(
            async (pod: PodEntry) => {
                const generationId = viewer.viewerCurrent?.generationId;
                if (!generationId || viewerActionBusy) return;
                setViewerActionBusy(true);
                try {
                    const prompt = await getViewerGenerationPrompt(generationId);
                    // Fire and forget — the pod button reports state.
                    if (prompt) void handlePodGenerate(pod, prompt);
                } catch (err: any) {
                    alert(`Failed to regenerate: ${err.message ?? String(err)}`);
                } finally {
                    setViewerActionBusy(false);
                }
            },
            [viewer.viewerCurrent, viewerActionBusy, getViewerGenerationPrompt, handlePodGenerate]
        );

        const handleViewerCreateWorkflow = React.useCallback(async () => {
            const generationId = viewer.viewerCurrent?.generationId;
            if (!generationId || viewerActionBusy) return;
            setViewerActionBusy(true);
            try {
                const prompt = await getViewerGenerationPrompt(generationId);
                if (!prompt) return;
                const created = await createWorkflow({
                    name: generationId,
                    description: store.selectedWorkflow
                        ? `Created from generation "${generationId}" of workflow "${store.selectedWorkflow.name}".`
                        : `Created from generation "${generationId}".`,
                    raw: prompt
                });
                // Load the new workflow the same way the sidebar does.
                viewer.closeViewer();
                await selectWorkflow(created.id);
            } catch (err: any) {
                alert(`Failed to create workflow: ${err.message ?? String(err)}`);
            } finally {
                setViewerActionBusy(false);
            }
        }, [viewer.viewerCurrent, viewerActionBusy, getViewerGenerationPrompt, createWorkflow, store.selectedWorkflow, viewer, selectWorkflow]);

        // ── OUTPUT tab view mode (list vs thumbnail masonry grid) ──────

        const [outputView, setOutputView] = React.useState<OutputViewMode>('list');

        // Streams a result item's raw bytes — the thumbnail grid points
        // its <img>/<video> straight at the generation result endpoint.
        const getResultMediaUrl = React.useCallback(
            (generationId: string, resultIndex: number) =>
                generationResultUrl(store.config.baseUrl, editingWorkflowId ?? '', generationId, resultIndex),
            [store.config.baseUrl, editingWorkflowId]
        );

        // ── Workflow actions (clone / rename / delete / generation delete) ──

        const actions = useWorkflowActions({
            editingWorkflowId,
            selectedWorkflow: store.selectedWorkflow,
            cloneWorkflow,
            // Clone snapshots the page as-is — unsaved widget edits and
            // PROMPT field selection included.
            getCurrentRaw: editor.serializeCurrentRaw,
            deleteWorkflow,
            deleteGeneration,
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
                            onDeleteGeneration={actions.handleDeleteGeneration}
                            outputView={outputView}
                            getResultMediaUrl={getResultMediaUrl}
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
                            contentTab={editor.contentTab}
                            outputView={outputView}
                            onOutputViewChange={setOutputView}
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

                {/* Per-generation delete confirmation (OUTPUT tab ✕ buttons) */}
                {actions.deleteGenerationTarget && (
                    <DeleteGenerationDialog
                        generationId={actions.deleteGenerationTarget}
                        onConfirm={actions.confirmDeleteGeneration}
                        onCancel={actions.cancelDeleteGeneration}
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
                        pods={pods}
                        onGenerate={handleViewerGenerate}
                        onPodGenerate={handleViewerPodGenerate}
                        onCreateWorkflow={handleViewerCreateWorkflow}
                        actionBusy={viewerActionBusy}
                    />
                )}
            </>
        );
    }
);
