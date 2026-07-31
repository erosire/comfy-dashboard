// Poll the generation list for the selected workflow.
//
// The server processes pod streams in the background, so the client polls
// every 5 s to keep the OUTPUT tab fresh and to settle pod run state.
//
// Extracted from the original CloudTab.tsx polling effect.

import React from 'react';

export function useGenerationsPolling(
    editingWorkflowId: string | null,
    refreshGenerations: (workflowId: string) => Promise<void>
): void {
    React.useEffect(() => {
        if (!editingWorkflowId) return;
        refreshGenerations(editingWorkflowId);
        const interval = setInterval(() => {
            refreshGenerations(editingWorkflowId);
        }, 5000);
        return () => clearInterval(interval);
    }, [editingWorkflowId, refreshGenerations]);
}
