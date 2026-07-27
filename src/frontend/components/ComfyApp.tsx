// Main dashboard component for ComfyUI Cloud.
//
// Wraps the CloudTab with the DashboardStoreProvider and BootstrapLayer
// so all workflow state is managed centrally.

import React from 'react';
import { styled, theme } from '../styles';
import { DashboardStoreProvider } from '../context';
import { BootstrapLayer } from './BootstrapLayer';
import { CloudTab } from './CloudTab';

const FullScreen = styled('div', {
    position: 'fixed',
    inset: 0,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: theme.bg
});

const DarkThemeWrapper = styled('div', {
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

export type ComfyAppProps = {
    configOverrides?: { baseUrl?: string };
};

export const ComfyApp: React.FC<ComfyAppProps> = React.memo(({ configOverrides }) => {
    return (
        <DashboardStoreProvider configOverrides={configOverrides}>
            <BootstrapLayer />
            <FullScreen>
                <DarkThemeWrapper>
                    <CloudTab baseUrl={configOverrides?.baseUrl} />
                </DarkThemeWrapper>
            </FullScreen>
        </DashboardStoreProvider>
    );
});
