// Barrel export for the comfy-dashboard distribution.
// Re-exports the public App component and the building-block modules so
// consumers can compose their own dashboards if needed.

export { App } from './frontend/App';
export { ComfyApp } from './frontend/components/ComfyApp';
export { DashboardStoreProvider, useDashboardStore } from './frontend/context';
export { fetchWorkflows, fetchWorkflow, createWorkflow, deleteWorkflow, fetchQueue, queueWorkflow, fetchStatus } from './frontend/api';
export type { WorkflowMeta, Workflow, QueueItem, ServerStatus } from './frontend/api';
export type { DashboardStore } from './frontend/context';
