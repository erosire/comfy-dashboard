// DashboardHeaderControls — the dashboard's header fragment: sidebar
// toggle, the workflow title (click to rename when saved) and the
// load-warning badge.
//
// Extracted verbatim from the original CloudTab.tsx header fragment.

import React from 'react';
import { theme } from '../../../styles';
import { Badge, HeaderTitle, ToggleButton } from './ui';

export type DashboardHeaderControlsProps = {
    onToggleSidebar: () => void;
    /** Header title — the saved workflow's name, or "Comfy Dashboard". */
    title: string;
    /** Whether clicking the title opens the rename dialog (saved workflow). */
    titleClickable: boolean;
    onTitleClick: () => void;
    loadWarning?: string;
};

export const DashboardHeaderControls: React.FC<DashboardHeaderControlsProps> = ({
    onToggleSidebar,
    title,
    titleClickable,
    onTitleClick,
    loadWarning
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
    </>
);
