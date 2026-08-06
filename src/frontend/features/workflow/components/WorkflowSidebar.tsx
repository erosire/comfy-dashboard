// WorkflowSidebar — left panel listing the saved workflows with search.
//
// Extracted verbatim from the original CloudTab.tsx sidebar fragment.
// Shows at most MAX_SIDEBAR_ITEMS entries with a "+N more" hint beyond
// that. On startup and whenever the selected workflow changes, the list
// scrolls the selected item into view instead of following unrelated pod
// updates. Pod status changes must never change the user's workflow position.

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
};

export const WorkflowSidebar: React.FC<WorkflowSidebarProps> = ({
    workflows,
    selectedId,
    searchText,
    onSearchChange,
    onSelect
}) => {
    const sidebarScrollRef = React.useRef<HTMLDivElement>(null);
    // The ref follows the active row so the startup effect can target the
    // actual rendered element after either the cached or server workflow list
    // arrives. A single ref is sufficient because exactly one row is active.
    const selectedItemRef = React.useRef<HTMLDivElement>(null);

    // Restore the selected workflow's position after the list is mounted or
    // replaced. `useLayoutEffect` runs after refs are attached but before the
    // browser paints, preventing the visible random-bottom/random-top jump
    // caused by the former pod-driven scroll effect.
    React.useLayoutEffect(() => {
        const selectedItem = selectedItemRef.current;
        if (!selectedItem || !sidebarScrollRef.current) return;
        // `nearest` keeps an already-visible selection stable while bringing a
        // selection outside the viewport into view. The explicit alignment
        // avoids browser default differences and intentionally does not use a
        // smooth animation during initial hydration.
        selectedItem.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [selectedId, searchText, workflows]);

    const displayedWorkflows = React.useMemo(() => {
        const firstPage = workflows.slice(0, MAX_SIDEBAR_ITEMS);
        // A persisted selection can be older than the first page returned by
        // the server. Replace the last visible row in that case so every valid
        // selected workflow still has a DOM target for deterministic scrolling.
        if (selectedId && !firstPage.some((workflow) => workflow.id === selectedId)) {
            const selectedWorkflow = workflows.find((workflow) => workflow.id === selectedId);
            if (selectedWorkflow) {
                return [...workflows.slice(0, Math.max(0, MAX_SIDEBAR_ITEMS - 1)), selectedWorkflow];
            }
        }
        return firstPage;
    }, [workflows, selectedId]);

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
                            ref={isActive ? selectedItemRef : undefined}
                            onClick={() => onSelect(wf)}
                            data-testid={`workflow-item-${wf.id}`}
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
