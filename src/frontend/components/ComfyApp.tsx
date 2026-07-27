// Main dashboard component for ComfyUI.
//
// Composes the two-column layout with:
//   - Sidebar: workflow list (SectionWorkflowList)
//   - Content: workflow detail / queue / status (placeholder for now)
//   - Footer: action bar
//
// Header has sidebar toggle + title + optional server status badge.

import React from 'react';
import { styled, theme } from '../styles';
import { DashboardStoreProvider, useDashboardStore } from '../context';
import { BootstrapLayer } from './BootstrapLayer';
import { ComfyDashboard } from './ComfyDashboard';

// ── Styled elements ───────────────────────────────────────────────────

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

const ToggleButton = styled('button', {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    flex: '0 0 auto',
    borderRadius: theme.radiusMd,
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface1,
    color: theme.text,
    cursor: 'pointer',
    fontSize: theme.fontSize.xl,
    lineHeight: 1,
    padding: 0,
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`
});

const HeaderTitle = styled('span', {
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.text,
    letterSpacing: 0.2,
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const
});

const StatusBadge = styled('span', {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: theme.fontSize.sm,
    color: theme.textDim,
    marginLeft: 8,
    padding: '2px 8px',
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surface2,
    border: `1px solid ${theme.border}`
});

const StatusDot = styled('span', {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flex: '0 0 auto'
});

// ── Sidebar: Workflow list ────────────────────────────────────────────

const WorkflowListPanel = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden'
});

const WorkflowListHeader = styled('div', {
    padding: '10px 12px 6px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5
});

const WorkflowListScroll = styled('div', {
    flex: '1 1 auto',
    overflowY: 'auto'
});

const WorkflowItem = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 12px',
    cursor: 'pointer',
    borderBottom: `1px solid ${theme.border}`,
    transition: `background-color ${theme.transition}`
});

const WorkflowItemName = styled('span', {
    fontSize: theme.fontSize.body,
    fontWeight: 500,
    color: theme.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const
});

const WorkflowItemMeta = styled('span', {
    fontSize: theme.fontSize.xs,
    color: theme.textDim,
    marginTop: 2
});

const EmptyState = styled('div', {
    padding: '20px 12px',
    fontSize: theme.fontSize.sm,
    color: theme.textDim,
    textAlign: 'center' as const
});

// ── Footer ────────────────────────────────────────────────────────────

const FooterRow = styled('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
});

const FooterButton = styled('button', {
    padding: '6px 14px',
    fontSize: theme.fontSize.base,
    fontWeight: 600,
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface1,
    color: theme.textMuted,
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`
});

// ── Content: Placeholder ──────────────────────────────────────────────

const ContentPlaceholder = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 12,
    color: theme.textDim,
    fontSize: theme.fontSize.body,
    padding: 20
});

const ContentTitle = styled('div', {
    fontSize: theme.fontSize.xl,
    fontWeight: 600,
    color: theme.textMuted
});

const ContentSubtitle = styled('div', {
    fontSize: theme.fontSize.base,
    color: theme.textDim
});

// ── Header Controls ───────────────────────────────────────────────────

const HeaderControls: React.FC<{
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
}> = React.memo(({ sidebarOpen, onToggleSidebar }) => {
    const { store } = useDashboardStore();
    const { status } = store;
    const connected = status?.connected ?? false;

    return (
        <>
            <ToggleButton
                onClick={onToggleSidebar}
                aria-label="Toggle workflow sidebar"
                data-testid="sidebar-toggle"
                className="sg-hover"
            >
                ☰
            </ToggleButton>
            <HeaderTitle>Comfy Dashboard</HeaderTitle>
            <StatusBadge>
                <StatusDot style={{ backgroundColor: connected ? theme.success : theme.danger }} />
                {connected ? 'Connected' : 'Disconnected'}
            </StatusBadge>
        </>
    );
});

// ── Sidebar Content ───────────────────────────────────────────────────

const SidebarContent: React.FC = React.memo(() => {
    const { store, setStore } = useDashboardStore();
    const { workflows, selectedId } = store;

    const handleSelect = React.useCallback((id: string) => {
        setStore((prev) => ({ ...prev, selectedId: prev.selectedId === id ? null : id }));
    }, [setStore]);

    return (
        <WorkflowListPanel>
            <WorkflowListHeader>Workflows ({workflows.length})</WorkflowListHeader>
            <WorkflowListScroll className="sg-scroll">
                {workflows.length === 0 ? (
                    <EmptyState>No workflows loaded</EmptyState>
                ) : (
                    workflows.map((w) => (
                        <WorkflowItem
                            key={w.id}
                            data-testid={`workflow-item-${w.id}`}
                            className={`sg-workflow-item ${w.id === selectedId ? 'sg-workflow-selected' : ''}`}
                            onClick={() => handleSelect(w.id)}
                        >
                            <WorkflowItemName>{w.name}</WorkflowItemName>
                            <WorkflowItemMeta>
                                {w.nodeCount} nodes · {w.tags?.join(', ') || 'untagged'}
                            </WorkflowItemMeta>
                        </WorkflowItem>
                    ))
                )}
            </WorkflowListScroll>
        </WorkflowListPanel>
    );
});

// ── Main Content ──────────────────────────────────────────────────────

const MainContent: React.FC = React.memo(() => {
    const { store } = useDashboardStore();
    const { selectedId, workflows, queue } = store;

    const selected = workflows.find((w) => w.id === selectedId);

    if (selected) {
        return (
            <ContentPlaceholder data-testid="workflow-detail">
                <ContentTitle>{selected.name}</ContentTitle>
                <ContentSubtitle>{selected.description || 'No description'}</ContentSubtitle>
                <ContentSubtitle>{selected.nodeCount} nodes · Created {new Date(selected.createdDate).toLocaleDateString()}</ContentSubtitle>
            </ContentPlaceholder>
        );
    }

    return (
        <ContentPlaceholder data-testid="empty-content">
            <ContentTitle>Select a workflow</ContentTitle>
            <ContentSubtitle>
                {queue.length > 0 ? `${queue.length} item(s) in queue` : 'Queue is empty'}
            </ContentSubtitle>
        </ContentPlaceholder>
    );
});

// ── Footer Content ────────────────────────────────────────────────────

const FooterContent: React.FC = React.memo(() => {
    const { store, refreshWorkflows, refreshQueue } = useDashboardStore();

    return (
        <FooterRow>
            <FooterButton className="sg-hover" onClick={refreshWorkflows}>
                Refresh Workflows
            </FooterButton>
            <FooterButton className="sg-hover" onClick={refreshQueue}>
                Refresh Queue
            </FooterButton>
            {store.loadWarning && (
                <StatusBadge style={{ marginLeft: 'auto', color: theme.warning }}>
                    {store.loadWarning}
                </StatusBadge>
            )}
        </FooterRow>
    );
});

// ── Composed App ──────────────────────────────────────────────────────

export type ComfyAppProps = {
    configOverrides?: { baseUrl?: string; pollIntervalMs?: number };
    initialStore?: Partial<React.ComponentProps<typeof DashboardStoreProvider>['initialStore']>;
};

export const ComfyApp: React.FC<ComfyAppProps> = React.memo(
    ({ configOverrides, initialStore }) => {
        const [sidebarOpen, setSidebarOpen] = React.useState(() => {
            if (typeof window !== 'undefined' && window.matchMedia) {
                return window.matchMedia('(min-width: 768px)').matches;
            }
            return true;
        });

        const toggleSidebar = React.useCallback(() => setSidebarOpen((prev) => !prev), []);

        return (
            <DashboardStoreProvider configOverrides={configOverrides} initialStore={initialStore}>
                <BootstrapLayer />
                <FullScreen>
                    <DarkThemeWrapper>
                        <ComfyDashboard
                            sidebarOpen={sidebarOpen}
                            onOverlayClick={toggleSidebar}
                            headerControls={
                                <HeaderControls
                                    sidebarOpen={sidebarOpen}
                                    onToggleSidebar={toggleSidebar}
                                />
                            }
                            sidebar={<SidebarContent />}
                            content={<MainContent />}
                            footer={<FooterContent />}
                        />
                    </DarkThemeWrapper>
                </FullScreen>
            </DashboardStoreProvider>
        );
    }
);
