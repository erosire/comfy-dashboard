// BootstrapLayer — hydrates the dashboard store from the server on mount.
//
// Fetches workflows on first render. If the server is unreachable,
// sets loadWarning on the store so the header can show a badge.

import React, { useEffect } from 'react';
import { useDashboardStore } from '../context';

export const BootstrapLayer: React.FC = () => {
    const { refreshWorkflows } = useDashboardStore();

    useEffect(() => {
        refreshWorkflows();
    }, [refreshWorkflows]);

    return null;
};
