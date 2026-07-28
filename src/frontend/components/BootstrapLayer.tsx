// BootstrapLayer — hydrates the dashboard store from the server on mount.
//
// Fetches workflows, queue, and status on first render. If the server is
// unreachable, sets loadWarning on the store so the header can show a badge.

import React, { useEffect } from 'react';
import { useDashboardStore } from '../context';

export const BootstrapLayer: React.FC = () => {
    const { refreshWorkflows, refreshQueue, refreshStatus, refreshCloudQueue } = useDashboardStore();

    useEffect(() => {
        refreshWorkflows();
        refreshQueue();
        refreshStatus();
        refreshCloudQueue();
    }, [refreshWorkflows, refreshQueue, refreshStatus, refreshCloudQueue]);

    return null;
};
