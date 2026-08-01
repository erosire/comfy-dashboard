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
import { fetchWorkflow as fetchWorkflowApi, generationResultUrl } from '../../api';
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
    buildWorkflowWithInputs,
    fetchMediaAsDataUri,
    useDebouncedSearch,
    useGenerationsPolling,
    useMediaQuery,
    usePods,
    useResultViewer,
    useWorkflowActions,
    useWorkflowEditor,
    type GenerationSnapshot,
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

        const { pods, handleGenerate, handlePodGenerate, handleAutoGenerate } = usePods({
            baseUrl,
            nodes: editor.nodes,
            editingWorkflowId,
            workflowName: store.selectedWorkflow?.name ?? null,
            generations: store.generations,
            // Every generation snapshots the live editor json as its
            // stored prompt — the lossless original the server converts
            // to an API prompt at submission and "Create Workflow" copies.
            getCurrentRaw: editor.serializeCurrentRaw,
            generateWorkflow
        });

        // ── Result viewer (image/video modal) ─────────────────────────

        const viewer = useResultViewer({
            selectedId: store.selectedId,
            generations: store.generations,
            baseUrl: store.config.baseUrl
        });

        // ── Viewer rerun / create-workflow actions ────────────────────
        // The OUTPUT list carries lightweight generation summaries — the
        // generation's stored original workflow json (reruns resubmit it,
        // "Create Workflow" copies it) is fetched on demand and cached
        // per generation id while the workflow stays selected, so
        // navigating back and forth never refetches.

        const viewerSnapshotCacheRef = React.useRef<Map<string, GenerationSnapshot>>(new Map());
        const [viewerActionBusy, setViewerActionBusy] = React.useState(false);

        // Cached snapshots belong to the currently loaded workflow.
        React.useEffect(() => {
            viewerSnapshotCacheRef.current.clear();
        }, [editingWorkflowId]);

        const getViewerGenerationSnapshot = React.useCallback(
            async (generationId: string): Promise<GenerationSnapshot | null> => {
                const cached = viewerSnapshotCacheRef.current.get(generationId);
                if (cached) return cached;
                if (!editingWorkflowId) return null;
                const full = await fetchGeneration(editingWorkflowId, generationId);
                // The stored prompt IS the original workflow json — a
                // lossless document, used verbatim for both reruns
                // (the server converts it to an API prompt at submission)
                // and workflow creation (a byte-for-byte copy).
                const snapshot: GenerationSnapshot = full.prompt;
                viewerSnapshotCacheRef.current.set(generationId, snapshot);
                return snapshot;
            },
            [editingWorkflowId, fetchGeneration]
        );

        // ── Viewer Input-target selection ────────────────────────────
        // Workflows that declare Input markings (extra.inputFields —
        // surfaced by the list endpoint as meta.inputFields) populate the
        // preview dropdown. The dropdown only ARMS a target: nothing
        // fires until New / #N / Auto is pressed, the target workflow is
        // never modified or navigated to, and the resulting generation is
        // saved on the workflow being viewed.

        const inputTargets = React.useMemo(
            () =>
                store.workflows
                    .filter((w) => (w.inputFields?.length ?? 0) > 0)
                    .map((w) => ({ id: w.id, name: w.name })),
            [store.workflows]
        );

        // Selected dropdown target — null means "Default" (rerun the
        // viewed image's own stored prompt).
        const [viewerInputTargetId, setViewerInputTargetId] = React.useState<string | null>(null);

        // The selection belongs to an open viewer session — reset it when
        // the viewer closes or the loaded workflow changes.
        React.useEffect(() => {
            if (!viewer.viewerOpen) setViewerInputTargetId(null);
        }, [viewer.viewerOpen]);
        React.useEffect(() => {
            setViewerInputTargetId(null);
        }, [editingWorkflowId]);

        // Build the fed snapshot for an armed Input target: an in-memory
        // COPY of the selected workflow's document with the viewed image's
        // base64 data stream written into its marked Input fields (Data
        // URI / Universal Data Input widgets). The target workflow itself
        // is never modified, saved, or navigated to. Returns the injected
        // document plus the target's display name (for forking/naming).
        const buildViewerInputSnapshot = React.useCallback(
            async (targetWorkflowId: string): Promise<{ snapshot: GenerationSnapshot; name: string }> => {
                const entry = viewer.viewerCurrent;
                if (!entry || entry.type !== 'image' || !viewer.viewerMediaUrl) {
                    throw new Error('Only image results can feed workflow Inputs.');
                }
                // The image's bytes as a base64 data stream — what a
                // Universal Data Input (data_uri) widget consumes.
                const dataUri = await fetchMediaAsDataUri(viewer.viewerMediaUrl, entry.mimeType || 'image/png');
                const { workflow: target } = await fetchWorkflowApi(
                    `${store.config.baseUrl}/workflows`,
                    targetWorkflowId
                );
                const injected = buildWorkflowWithInputs(target.raw, dataUri);
                if (!injected) {
                    throw new Error(
                        `Workflow "${target.name}" has no usable Input fields — ` +
                            'mark a Data URI (Universal Data Input) field as Input in its PROMPT tab first.'
                    );
                }
                return { snapshot: injected, name: target.name };
            },
            [viewer.viewerCurrent, viewer.viewerMediaUrl, store.config.baseUrl]
        );

        // Shared spine for the viewer rerun buttons. "Default": resubmit
        // the viewed image's stored prompt. With an Input target armed:
        // feed the image into an injected copy of that workflow instead.
        // Either way the generation is recorded under the CURRENTLY
        // VIEWED workflow (same as every other rerun).
        const runViewerGeneration = React.useCallback(
            async (run: (snapshot: GenerationSnapshot) => void) => {
                const generationId = viewer.viewerCurrent?.generationId;
                if (!generationId || viewerActionBusy) return;
                setViewerActionBusy(true);
                try {
                    if (viewerInputTargetId) {
                        const { snapshot } = await buildViewerInputSnapshot(viewerInputTargetId);
                        run(snapshot);
                    } else {
                        const snapshot = await getViewerGenerationSnapshot(generationId);
                        if (snapshot) run(snapshot);
                    }
                } catch (err: any) {
                    alert(`Failed to regenerate: ${err.message ?? String(err)}`);
                } finally {
                    setViewerActionBusy(false);
                }
            },
            [
                viewer.viewerCurrent,
                viewerActionBusy,
                viewerInputTargetId,
                buildViewerInputSnapshot,
                getViewerGenerationSnapshot
            ]
        );

        const handleViewerGenerate = React.useCallback(() => {
            // Fire and forget — the spawned "#N" button reports state.
            void runViewerGeneration((snapshot) => void handleGenerate(snapshot));
        }, [runViewerGeneration, handleGenerate]);

        const handleViewerPodGenerate = React.useCallback(
            (pod: PodEntry) => {
                // Fire and forget — the pod button reports state.
                void runViewerGeneration((snapshot) => void handlePodGenerate(pod, snapshot));
            },
            [runViewerGeneration, handlePodGenerate]
        );

        const handleViewerAutoGenerate = React.useCallback(() => {
            // Fire and forget — the picked pod's button reports state.
            void runViewerGeneration((snapshot) => void handleAutoGenerate(snapshot));
        }, [runViewerGeneration, handleAutoGenerate]);

        const handleViewerForkWorkflow = React.useCallback(async () => {
            const generationId = viewer.viewerCurrent?.generationId;
            if (!generationId || viewerActionBusy) return;
            setViewerActionBusy(true);
            try {
                let snapshot: GenerationSnapshot | null;
                let name: string;
                let description: string;
                if (viewerInputTargetId) {
                    // Fork the SELECTED workflow with the viewed image fed
                    // into its Input fields — the fed copy becomes the new
                    // workflow (the selected one stays untouched).
                    const fed = await buildViewerInputSnapshot(viewerInputTargetId);
                    snapshot = fed.snapshot;
                    name = `${fed.name} (Fork)`;
                    description =
                        `Fork of workflow "${fed.name}" with the image of generation "${generationId}" ` +
                        'fed into its Input fields.';
                } else {
                    // Copy the stored original workflow json VERBATIM — no
                    // parse → re-serialize round trip, so widgets/links/groups
                    // arrive exactly as stored.
                    snapshot = await getViewerGenerationSnapshot(generationId);
                    if (!snapshot) return;
                    name = generationId;
                    description = store.selectedWorkflow
                        ? `Forked from generation "${generationId}" of workflow "${store.selectedWorkflow.name}".`
                        : `Forked from generation "${generationId}".`;
                }
                const created = await createWorkflow({ name, description, raw: snapshot });
                // Load the new workflow the same way the sidebar does.
                viewer.closeViewer();
                await selectWorkflow(created.id);
            } catch (err: any) {
                alert(`Failed to fork workflow: ${err.message ?? String(err)}`);
            } finally {
                setViewerActionBusy(false);
            }
        }, [
            viewer.viewerCurrent,
            viewerActionBusy,
            viewerInputTargetId,
            buildViewerInputSnapshot,
            getViewerGenerationSnapshot,
            createWorkflow,
            store.selectedWorkflow,
            viewer,
            selectWorkflow
        ]);

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
                            inputFields={editor.inputFields}
                            updateNodeWidget={editor.updateNodeWidget}
                            toggleNodeBypass={editor.toggleNodeBypass}
                            togglePromptField={editor.togglePromptField}
                            toggleInputField={editor.toggleInputField}
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
                            onAutoGenerate={handleAutoGenerate}
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
                        onAutoGenerate={handleViewerAutoGenerate}
                        onForkWorkflow={handleViewerForkWorkflow}
                        inputTargets={inputTargets}
                        inputTargetId={viewerInputTargetId}
                        onInputTargetChange={setViewerInputTargetId}
                        actionBusy={viewerActionBusy}
                    />
                )}
            </>
        );
    }
);
