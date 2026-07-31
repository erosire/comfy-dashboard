// WorkflowEditorContent — the dashboard's content fragment.
//
// Empty state: the entire area is the drop zone.
// Loaded state: a scrollable editor area with the drag-replace inset, the
// PROMPT / JSON / OUTPUT tab strip, the active pane, and the workflow
// action bar (hidden on the OUTPUT tab).
//
// Extracted verbatim from the original CloudTab.tsx content fragment.

import React from 'react';
import styled from '@emotion/styled';
import { theme } from '../../../styles';
import type { GenerationSummary } from '../../../api';
import type { UINode } from '../../../nodes/node-type';
import type { EditorContentTab, PromptWidgetRef } from './utils';
import { NodeList } from './ui';
import { DropReplaceInset, EditorDropZone } from './EditorDropZone';
import { ContentTabStrip } from './ContentTabStrip';
import { JsonNodePane } from './JsonNodePane';
import { PromptFieldsPane } from './PromptFieldsPane';
import { GenerationsPane } from './GenerationsPane';
import { WorkflowActionBar } from './WorkflowActionBar';

const EditorArea = styled('div')({
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: '14px 24px'
});

export type WorkflowEditorContentProps = {
    nodes: UINode[];
    dragOver: boolean;
    onDrop: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    /** Editing a server-stored workflow (shows Clone, the action bar...). */
    isEditingSaved: boolean;
    /** Saved workflow's current name (shown in the empty drop zone). */
    selectedWorkflowName?: string;
    isMobile: boolean;
    contentTab: EditorContentTab;
    onSelectTab: (tab: EditorContentTab) => void;
    promptFields: Set<string>;
    promptEntries: PromptWidgetRef[];
    executingNodeId: string | null;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    toggleNodeBypass: (nodeId: string) => void;
    togglePromptField: (node: UINode, widgetIdx: number) => void;
    onCopyJson: () => void;
    onClone: () => void;
    generations: GenerationSummary[];
    onOpenViewer: (generationId: string) => void;
    saving: boolean;
    onSave: () => void;
    onDelete: () => void;
};

export const WorkflowEditorContent: React.FC<WorkflowEditorContentProps> = ({
    nodes,
    dragOver,
    onDrop,
    onDragOver,
    onDragLeave,
    isEditingSaved,
    selectedWorkflowName,
    isMobile,
    contentTab,
    onSelectTab,
    promptFields,
    promptEntries,
    executingNodeId,
    updateNodeWidget,
    toggleNodeBypass,
    togglePromptField,
    onCopyJson,
    onClone,
    generations,
    onOpenViewer,
    saving,
    onSave,
    onDelete
}) => (
    <>
        {/* Empty state: entire area is the drop zone */}
        {nodes.length === 0 && (
            <EditorDropZone
                dragOver={dragOver}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                editTargetName={isEditingSaved ? selectedWorkflowName : undefined}
            />
        )}

        {/* Node list */}
        {nodes.length > 0 && (
            <EditorArea
                className="sg-scroll"
                onDrop={onDrop}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                style={{
                    ...(dragOver ? { backgroundColor: theme.accentSoft } : undefined),
                    // Narrower horizontal padding on mobile — the default
                    // 24px per side eats too much of a small screen.
                    paddingLeft: isMobile ? 8 : 24,
                    paddingRight: isMobile ? 8 : 24
                }}
                data-testid="cloud-content-area"
            >
                <NodeList data-testid="cloud-node-list">
                    {dragOver && <DropReplaceInset />}

                    {/* Content tabs — PROMPT shows the selected prompt fields,
                        JSON shows the workflow layout, OUTPUT lists the
                        workflow's generations. Copy/Clone sit on the right
                        of the tab strip. */}
                    <ContentTabStrip
                        activeTab={contentTab}
                        promptFieldsCount={promptFields.size}
                        canClone={isEditingSaved}
                        onSelectTab={onSelectTab}
                        onCopy={onCopyJson}
                        onClone={onClone}
                    />

                    {/* JSON tab — the workflow node layout */}
                    {contentTab === 'json' && (
                        <JsonNodePane
                            nodes={nodes}
                            executingNodeId={executingNodeId}
                            promptFields={promptFields}
                            updateNodeWidget={updateNodeWidget}
                            toggleNodeBypass={toggleNodeBypass}
                            togglePromptField={togglePromptField}
                        />
                    )}

                    {/* PROMPT tab — compact list of every field toggled on
                        the JSON side, in workflow (display) order. Edits
                        write into the same tree state the JSON tab shows. */}
                    {contentTab === 'prompt' && (
                        <PromptFieldsPane
                            entries={promptEntries}
                            togglePromptField={togglePromptField}
                            updateNodeWidget={updateNodeWidget}
                        />
                    )}

                    {/* OUTPUT tab — the workflow's generations (moved out
                        of the sidebar). The editor area scrolls, so no
                        height cap is needed here. */}
                    {contentTab === 'results' && (
                        <GenerationsPane generations={generations} onOpenViewer={onOpenViewer} />
                    )}
                </NodeList>

                {/* Workflow action bar — sits at the bottom of the node
                    list, below the JSON/PROMPT tabs. Delete on the left,
                    Save on the right. Hidden on the OUTPUT tab, where
                    neither action applies. The pod run controls (#N)
                    live in the footer, immediately left of Generate. */}
                {isEditingSaved && contentTab !== 'results' && (
                    <WorkflowActionBar saving={saving} onSave={onSave} onDelete={onDelete} />
                )}
            </EditorArea>
        )}
    </>
);
