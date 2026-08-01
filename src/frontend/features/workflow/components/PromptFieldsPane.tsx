// PromptFieldsPane — the PROMPT tab: a compact list of every field toggled
// on the JSON side, in workflow (display) order. Edits write into the same
// tree state the JSON tab shows.
//
// Layout: each entry is a bordered card, mirroring the JSON tab's node
// cards (same NodeCard/NodeHeader/NodeInputs primitives) — a header band
// with the widget title on the left and the owning node (name + id) plus
// a ✕ remove affordance pushed to the far right, then the widget editor
// filling the full card width in the body beneath it.

import React from 'react';
import styled from '@emotion/styled';
import { theme } from '../../../styles';
import { comfyNodeRegistry } from '../../../../comfy';
import type { UINode } from '../../../nodes/node-type';
import { nodeDisplayName, widgetLabel, type PromptWidgetRef } from './utils';
import { WidgetValueEditor } from './WidgetValueEditor';
import { EmptyHint, NodeCard, NodeHeader, NodeId, NodeInputs, NodeList } from './ui';

// PromptFieldHeader — the card's clickable header band. Clicking anywhere
// removes the field from the PROMPT tab (same affordance the plain header
// line had); on hover the band brightens and the ✕ lights up red to
// preview the destructive action.
const PromptFieldHeader = styled(NodeHeader)({
    cursor: 'pointer',
    userSelect: 'none' as const,
    transition: `background-color ${theme.transition}`,
    '&:hover': {
        backgroundColor: theme.surface3
    },
    '&:hover .pf-remove': {
        color: theme.danger,
        borderColor: theme.dangerBorder,
        backgroundColor: theme.dangerSoft
    }
});

// PromptFieldRemove — the ✕ affordance at the far right of the header.
// Purely visual (the whole header is the click target), styled like the
// compact ghost ✕ used on generation rows: faint until the header hover
// paints it red.
const PromptFieldRemove = styled('span')({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    flex: '0 0 auto',
    borderRadius: theme.radiusSm,
    border: `1px solid transparent`,
    color: theme.textFaint,
    fontSize: theme.fontSize.xs,
    lineHeight: 1,
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`
});

export type PromptFieldsPaneProps = {
    entries: PromptWidgetRef[];
    togglePromptField: (node: UINode, widgetIdx: number) => void;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
};

export const PromptFieldsPane: React.FC<PromptFieldsPaneProps> = ({ entries, togglePromptField, updateNodeWidget }) => (
    <div data-testid="prompt-tab-pane">
        {entries.length === 0 ? (
            <EmptyHint>
                No fields selected — click a field label in the JSON tab to add it here.
            </EmptyHint>
        ) : (
            <NodeList>
                {entries.map(({ key, node, widget }) => (
                    <NodeCard key={key} data-testid={`prompt-field-${key}`}>
                        {/* Header band: widget title on the left; owning node
                            (name + id) and the ✕ affordance on the far right.
                            Clicking removes the field from the PROMPT tab. */}
                        <PromptFieldHeader
                            onClick={() => togglePromptField(node, widget.index)}
                            title={`Remove from the PROMPT tab (${node.title ?? node.classType} #${node.id})`}
                            data-testid={`prompt-field-header-${key}`}
                        >
                            <span
                                style={{
                                    fontSize: theme.fontSize.xs,
                                    fontFamily: theme.fontMono,
                                    color: theme.accent,
                                    fontWeight: 600,
                                    flex: '0 1 auto',
                                    minWidth: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                {widgetLabel(node, widget)}
                            </span>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    flex: '0 1 auto',
                                    minWidth: 0
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: theme.fontSize.xs,
                                        fontFamily: theme.fontMono,
                                        color: theme.textDim,
                                        minWidth: 0,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap',
                                        textAlign: 'right'
                                    }}
                                >
                                    {nodeDisplayName(node, comfyNodeRegistry[node.classType])}
                                </span>
                                <NodeId>#{node.id}</NodeId>
                                <PromptFieldRemove className="pf-remove" aria-hidden>
                                    ✕
                                </PromptFieldRemove>
                            </div>
                        </PromptFieldHeader>
                        {/* Editor body: a flex row so every control type (which
                            all use flex: 1 1 auto) stretches to the full card
                            width. */}
                        <NodeInputs>
                            <div style={{ display: 'flex' }}>
                                <WidgetValueEditor
                                    node={node}
                                    widget={widget}
                                    updateNodeWidget={updateNodeWidget}
                                    testId={`prompt-widget-${key}`}
                                />
                            </div>
                        </NodeInputs>
                    </NodeCard>
                ))}
            </NodeList>
        )}
    </div>
);
