// WorkflowSidebar — left panel listing the saved workflows with search.
//
// Extracted verbatim from the original CloudTab.tsx sidebar fragment.
// Shows at most MAX_SIDEBAR_ITEMS entries with a "+N more" hint beyond
// that. Auto-scrolls to the bottom whenever `scrollSignal` changes
// (the parent passes the pods list — the original auto-scrolled the
// sidebar on every pod update).

import React from 'react';
import styled from '@emotion/styled';
import { theme } from '../../../styles';
import type { WorkflowMeta } from '../../../api';
import { EmptyHint } from './ui';
import { MAX_SIDEBAR_ITEMS } from './utils';

const SidebarPanel = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden'
});

const SidebarHeader = styled('div')({
    padding: '10px 12px 6px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
});

const SidebarSearch = styled('div')({
    padding: '0 12px 8px',
    flex: '0 0 auto'
});

const SearchInput = styled('input')({
    width: '100%',
    padding: '5px 8px',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.text,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: `border-color ${theme.transition}`
});

const SidebarScroll = styled('div')({
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: '0 6px 12px'
});

const WorkflowItem = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 10px',
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`,
    border: `1px solid transparent`,
    marginBottom: 2
});

const WorkflowItemActive = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 10px',
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`,
    border: `1px solid ${theme.accentRing}`,
    marginBottom: 2,
    backgroundColor: theme.accentSoft
});

const WorkflowItemName = styled('div')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const
});

const WorkflowItemCount = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.accent2,
    fontWeight: 400
});

const SidebarCount = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    fontWeight: 400
});

export type WorkflowSidebarProps = {
    workflows: WorkflowMeta[];
    /** Id of the workflow currently loaded in the editor. */
    selectedId: string | null;
    /** Controlled search box text. */
    searchText: string;
    onSearchChange: (value: string) => void;
    onSelect: (workflow: WorkflowMeta) => void;
    /** Auto-scrolls the list to the bottom whenever this value changes. */
    scrollSignal?: unknown;
};

export const WorkflowSidebar: React.FC<WorkflowSidebarProps> = ({
    workflows,
    selectedId,
    searchText,
    onSearchChange,
    onSelect,
    scrollSignal
}) => {
    const sidebarScrollRef = React.useRef<HTMLDivElement>(null);

    // Auto-scroll results sidebar
    React.useEffect(() => {
        if (sidebarScrollRef.current) {
            sidebarScrollRef.current.scrollTop = sidebarScrollRef.current.scrollHeight;
        }
    }, [scrollSignal]);

    const displayedWorkflows = React.useMemo(() => {
        return workflows.slice(0, MAX_SIDEBAR_ITEMS);
    }, [workflows]);

    return (
        <SidebarPanel>
            <SidebarHeader>
                <span>
                    Workflows <SidebarCount>({workflows.length})</SidebarCount>
                </span>
            </SidebarHeader>
            <SidebarSearch>
                <SearchInput
                    type="text"
                    placeholder="Search workflows..."
                    value={searchText}
                    onChange={(e) => onSearchChange(e.target.value)}
                    data-testid="workflow-search"
                />
            </SidebarSearch>
            <SidebarScroll ref={sidebarScrollRef} className="sg-scroll" data-testid="workflow-list">
                {workflows.length === 0 && (
                    <EmptyHint>
                        {searchText
                            ? 'No workflows match your search.'
                            : 'No saved workflows yet.\nDrop a JSON file and save it.'}
                    </EmptyHint>
                )}
                {displayedWorkflows.map((wf) => {
                    const isActive = wf.id === selectedId;
                    const Item = isActive ? WorkflowItemActive : WorkflowItem;
                    return (
                        <Item
                            key={wf.id}
                            onClick={() => onSelect(wf)}
                            data-testid={`workflow-item-${wf.id}`}
                            style={isActive ? {} : undefined}
                            className={isActive ? '' : ''}
                        >
                            <WorkflowItemName>{wf.name}</WorkflowItemName>
                        </Item>
                    );
                })}
                {workflows.length > MAX_SIDEBAR_ITEMS && (
                    <EmptyHint style={{ padding: '8px 0' }}>
                        + {workflows.length - MAX_SIDEBAR_ITEMS} more...
                    </EmptyHint>
                )}
            </SidebarScroll>
        </SidebarPanel>
    );
};
