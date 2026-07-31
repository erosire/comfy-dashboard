// DashboardHeaderControls — the dashboard's header fragment: sidebar
// toggle, the workflow title (click to rename when saved), the load-warning
// badge, the agent counter and the spawn-agent button.
//
// Extracted verbatim from the original CloudTab.tsx header fragment.

import React from 'react';
import { theme } from '../../../styles';
import { Badge, HeaderTitle, SpawnAgentBtn, SpinnerEl, ToggleButton } from './ui';

export type DashboardHeaderControlsProps = {
    onToggleSidebar: () => void;
    /** Header title — the saved workflow's name, or "Comfy Dashboard". */
    title: string;
    /** Whether clicking the title opens the rename dialog (saved workflow). */
    titleClickable: boolean;
    onTitleClick: () => void;
    loadWarning?: string;
    agentCount: number;
    agentRunning: boolean;
    onSpawnAgent: () => void;
};

export const DashboardHeaderControls: React.FC<DashboardHeaderControlsProps> = ({
    onToggleSidebar,
    title,
    titleClickable,
    onTitleClick,
    loadWarning,
    agentCount,
    agentRunning,
    onSpawnAgent
}) => (
    <>
        <ToggleButton onClick={onToggleSidebar} className="sg-hover" aria-label="Toggle sidebar">
            ☰
        </ToggleButton>
        <HeaderTitle
            onClick={titleClickable ? onTitleClick : undefined}
            style={titleClickable ? { cursor: 'pointer' } : undefined}
        >
            {title}
        </HeaderTitle>

        {loadWarning && (
            <Badge style={{ marginLeft: 8, color: theme.warning, borderColor: theme.warningSoft }}>
                ⚠ {loadWarning}
            </Badge>
        )}

        <div style={{ flex: '1 1 auto' }} />

        {agentCount > 0 && (
            <Badge
                style={{
                    marginRight: 6,
                    color: agentRunning ? theme.accent : theme.success,
                    backgroundColor: agentRunning ? theme.accentSoft : theme.successSoft,
                    border: `1px solid ${agentRunning ? theme.accent : theme.success}`,
                    fontWeight: 600,
                    cursor: 'default'
                }}
                title={`${agentCount} agent${agentCount !== 1 ? 's' : ''} spawned`}
            >
                {agentCount}
            </Badge>
        )}

        <SpawnAgentBtn
            className="sg-primary"
            onClick={onSpawnAgent}
            disabled={agentRunning}
            title={agentRunning ? 'Agent running...' : 'Spawn agent to run generations'}
        >
            {agentRunning ? <SpinnerEl /> : '+'}
        </SpawnAgentBtn>
    </>
);
