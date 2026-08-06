// BootstrapLayer — hydrates the dashboard store from the server on mount.
//
// Fetches workflows on first render. If the server is unreachable,
// sets loadWarning on the store so the header can show a badge.

import React, { useEffect } from 'react';
import { useDashboardStore } from '../context';

export const BootstrapLayer: React.FC = () => {
    // Keep the persisted selection and detail loader available so the list
    // refresh can be followed by the full workflow fetch required by the
    // editor. The list endpoint only returns WorkflowMeta entries.
    const { store, refreshWorkflows, selectWorkflow } = useDashboardStore();

    useEffect(() => {
        // Bootstrap only runs for a change in the base-url-bound refresh
        // callback. The initial store snapshot contains the persisted id from
        // store.tsx:129-137; omitting store and selectWorkflow dependencies
        // prevents normal workflow state updates from repeating bootstrap.
        refreshWorkflows().then(() => {
            // A selected id identifies the workflow whose raw detail must be
            // loaded before the editor can derive its node list; store.tsx:262-
            // 277 performs that detail request and updates selectedWorkflow.
            if (store.selectedId) {
                selectWorkflow(store.selectedId);
            }
        });
    }, [refreshWorkflows]);

    return null;
};
