// Barrel export for the comfy-dashboard distribution.
// Re-exports the public App component and the building-block modules so
// consumers can compose their own dashboards if needed.

export { App } from './frontend/App';
// Back-compat aliases: the components were moved/renamed —
//   components/ComfyApp.tsx  → frontend/App.tsx (the App component)
//   components/CloudTab.tsx  → frontend/features/workflow/WorkflowDashboard.tsx
export { WorkflowDashboard } from './frontend/features/workflow';
export { WorkflowDashboard as CloudTab } from './frontend/features/workflow';
export { DashboardStoreProvider, useDashboardStore } from './frontend/context';
export {
    fetchWorkflows,
    fetchWorkflow,
    createWorkflow,
    updateWorkflow,
    deleteWorkflow,
    fetchQueue,
    queueWorkflow,
    fetchStatus,
    generateWorkflow,
    fetchGenerations,
    fetchGeneration,
    updateGeneration,
    generationResultUrl
} from './frontend/api';
export { cloudCreate, cloudListPods, cloudPrompt, cloudReadNdjson } from './frontend/api/cloud';
export type {
    WorkflowMeta,
    Workflow,
    WorkflowNode,
    QueueItem,
    ServerStatus,
    GenerationEntry,
    GenerationSummary,
    GenerationResultItem,
    GenerationResultMeta
} from './frontend/api';
export type {
    CloudCreateRequest,
    CloudCreateResult,
    CloudPodListEntry,
    CloudPodListResult,
    CloudStreamEvent
} from './frontend/api/cloud';
export type { DashboardStore } from './frontend/context';
