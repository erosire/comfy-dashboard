// Poll the generation list for the selected workflow.
//
// The server processes pod streams in the background, so the client polls
// every GENERATION_STATUS_POLL_INTERVAL_MS to keep the OUTPUT tab fresh and
// to settle pod run state.
//
// Extracted from the original CloudTab.tsx polling effect.

import React from 'react';
import { GENERATION_STATUS_POLL_INTERVAL_MS } from '../../../../config';

export function useGenerationsPolling(
    editingWorkflowId: string | null,
    refreshGenerations: (workflowId: string) => Promise<void>
): void {
    React.useEffect(() => {
        if (!editingWorkflowId) return;
        refreshGenerations(editingWorkflowId);
        const interval = setInterval(() => {
            refreshGenerations(editingWorkflowId);
        }, GENERATION_STATUS_POLL_INTERVAL_MS);
        return () => clearInterval(interval);
    }, [editingWorkflowId, refreshGenerations]);
}
