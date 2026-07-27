// Two-column dashboard layout for the comfy-dashboard.
//
// Layout:
//   ┌──────────────────────────────────────┐
//   │ [☰] Comfy Dashboard                 │  ← header
//   ├──────────┬───────────────────────────┤
//   │ Workflows│                           │
//   │ ──────── │     Content area          │
//   │ Flow 1   │     (workflow detail,     │
//   │ Flow 2   │      queue, status)       │
//   │          │                           │
//   ├──────────┴───────────────────────────┤
//   │ Footer / actions                     │  ← footer
//   └──────────────────────────────────────┘

import React from 'react';
import { styled, theme } from '../styles';

export const DashboardShell = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    width: '100%',
    overflow: 'hidden'
});

export const DashboardHeader = styled('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    flex: '0 0 auto',
    padding: '8px 14px',
    borderBottom: `1px solid ${theme.border}`,
    gap: 10,
    minHeight: 48,
    backgroundColor: theme.surface1
});

export const DashboardBody = styled('div', {
    display: 'flex',
    flexDirection: 'row',
    flex: '1 1 auto',
    overflow: 'hidden'
});

const DashboardSidebarPanel = styled('div', {
    flex: '0 0 auto',
    overflow: 'hidden',
    transition: `width ${theme.transitionSlow}, min-width ${theme.transitionSlow}, max-width ${theme.transitionSlow}, border-color ${theme.transitionSlow}`,
    backgroundColor: theme.surface1,
    boxSizing: 'border-box' as const
});

export const DashboardContent = styled('div', {
    flex: '1 1 auto',
    overflowY: 'auto',
    overflowX: 'hidden',
    position: 'relative' as const
});

const SidebarOverlay = styled('div', {
    position: 'absolute' as const,
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    zIndex: 10,
    cursor: 'pointer',
    animation: 'sg-fade-in 160ms ease both'
});

export const DashboardFooter = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    flex: '0 0 auto',
    padding: 14,
    borderTop: `1px solid ${theme.border}`,
    gap: 8,
    backgroundColor: theme.surface1
});

export type ComfyDashboardProps = {
    headerControls: React.ReactNode;
    sidebar: React.ReactNode;
    content: React.ReactNode;
    footer: React.ReactNode;
    sidebarOpen: boolean;
    onOverlayClick?: () => void;
};

export const ComfyDashboard: React.FC<ComfyDashboardProps> = React.memo(
    ({ headerControls, sidebar, content, footer, sidebarOpen, onOverlayClick }) => {
        const [isMobile, setIsMobile] = React.useState(() => {
            if (typeof window !== 'undefined' && window.matchMedia) {
                return window.matchMedia('(max-width: 767px)').matches;
            }
            return false;
        });

        React.useEffect(() => {
            if (typeof window === 'undefined' || !window.matchMedia) return;
            const mql = window.matchMedia('(max-width: 767px)');
            const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
            mql.addEventListener('change', handler);
            return () => mql.removeEventListener('change', handler);
        }, []);

        return (
            <DashboardShell>
                <DashboardHeader>
                    {headerControls}
                </DashboardHeader>
                <DashboardBody>
                    <DashboardSidebarPanel
                        data-testid="sidebar-panel"
                        className="sg-scroll"
                        style={{
                            width: sidebarOpen ? '12.5rem' : 0,
                            minWidth: sidebarOpen ? '12.5rem' : 0,
                            maxWidth: sidebarOpen ? '12.5rem' : 0,
                            borderRight: sidebarOpen ? `1px solid ${theme.border}` : 'none'
                        }}
                    >
                        {sidebar}
                    </DashboardSidebarPanel>
                    <DashboardContent>
                        {sidebarOpen && isMobile && onOverlayClick && (
                            <SidebarOverlay
                                data-testid="sidebar-overlay"
                                onClick={onOverlayClick}
                            />
                        )}
                        {content}
                    </DashboardContent>
                </DashboardBody>
                <DashboardFooter>{footer}</DashboardFooter>
            </DashboardShell>
        );
    }
);
