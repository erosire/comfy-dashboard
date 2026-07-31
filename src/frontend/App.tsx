// Main App component — the ComfyUI Cloud dashboard shell.
//
// Wraps the WorkflowDashboard with the DashboardStoreProvider and
// BootstrapLayer so all workflow state is managed centrally.
//
// (This file replaces the previous thin App wrapper that rendered
// components/ComfyApp.tsx — that component moved here.)

import React from 'react';
import styled from '@emotion/styled';
import { theme } from './styles';
import { DashboardStoreProvider } from './context';
import { BootstrapLayer } from './components';
import { WorkflowDashboard } from './features/workflow';

const FullScreen = styled('div')({
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: theme.bg
});

const DarkThemeWrapper = styled('div')({
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'transparent',
    color: theme.text,
    overflow: 'hidden',
    fontFamily: theme.fontSans,
    fontSize: theme.fontSize.body,
    WebkitFontSmoothing: 'antialiased' as const,
    textRendering: 'optimizeLegibility' as const
});

export type AppProps = {
    configOverrides?: { baseUrl?: string };
};

export const App: React.FC<AppProps> = React.memo(({ configOverrides }) => {
    return (
        <DashboardStoreProvider configOverrides={configOverrides}>
            <BootstrapLayer />
            <FullScreen>
                <DarkThemeWrapper>
                    <WorkflowDashboard baseUrl={configOverrides?.baseUrl} />
                </DarkThemeWrapper>
            </FullScreen>
        </DashboardStoreProvider>
    );
});
