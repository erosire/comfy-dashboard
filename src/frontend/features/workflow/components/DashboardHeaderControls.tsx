// DashboardHeaderControls — the dashboard's header fragment: sidebar
// toggle, the workflow title (click to rename when saved) and the
// load-warning badge.
//
// Extracted verbatim from the original CloudTab.tsx header fragment.

import React from 'react';
import { styledComponent } from '@presource/react';
import { theme } from '../../../styles';
import { HeaderTitle, ToggleButton } from './ui';

// Keep the title spacer and preference action as styled components so the
// header layout has no one-off inline layout objects.
const HeaderSpacer = styledComponent('div', {
    flex: '1 1 auto'
});

const PreferencesButton = styledComponent('button', {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    flex: '0 0 auto',
    padding: 0,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface1,
    color: theme.textMuted,
    cursor: 'pointer',
    transition: `background-color ${theme.transition}, border-color ${theme.transition}, color ${theme.transition}`
});

// The clickable title variant keeps the existing title typography while moving
// its pointer affordance into a named styled component instead of an inline
// style object.
const InteractiveHeaderTitle = styledComponent('span', {
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.text,
    letterSpacing: 0.2,
    whiteSpace: 'nowrap',
    userSelect: 'none',
    cursor: 'pointer'
});

// Warning styling remains a badge, but its spacing and semantic colors belong
// to this header-specific styled component so the JSX contains no CSS object.
const HeaderWarning = styledComponent('span', {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    marginLeft: 8,
    fontSize: theme.fontSize.xs,
    color: theme.warning,
    padding: '2px 8px',
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surface2,
    border: `1px solid ${theme.warningSoft}`
});

export type DashboardHeaderControlsProps = {
    onToggleSidebar: () => void;
    /** Header title — the saved workflow's name, or "Comfy Dashboard". */
    title: string;
    /** Whether clicking the title opens the rename dialog (saved workflow). */
    titleClickable: boolean;
    onTitleClick: () => void;
    loadWarning?: string;
    /** Opens the runtime preference profile editor. */
    onPreferencesClick: () => void;
};

export const DashboardHeaderControls: React.FC<DashboardHeaderControlsProps> = ({
    onToggleSidebar,
    title,
    titleClickable,
    onTitleClick,
    loadWarning,
    onPreferencesClick
}) => (
    <>
        <ToggleButton onClick={onToggleSidebar} className="sg-hover" aria-label="Toggle sidebar">
            ☰
        </ToggleButton>
        {titleClickable ? <InteractiveHeaderTitle
            onClick={titleClickable ? onTitleClick : undefined}
        >
            {title}
        </InteractiveHeaderTitle> : <HeaderTitle>{title}</HeaderTitle>}

        {loadWarning && (
            <HeaderWarning>
                ⚠ {loadWarning}
            </HeaderWarning>
        )}

        <HeaderSpacer />
        <PreferencesButton
            data-testid="preferences-button"
            className="sg-hover"
            onClick={onPreferencesClick}
            aria-label="Open preferences"
            title="Preferences"
        >
            {/* A compact SVG person mark stays legible in the dark header at all sizes. */}
            <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <circle cx="12" cy="7" r="3.5" />
                <path d="M5 21c.7-4.1 3-6.2 7-6.2s6.3 2.1 7 6.2" />
            </svg>
        </PreferencesButton>
    </>
);
