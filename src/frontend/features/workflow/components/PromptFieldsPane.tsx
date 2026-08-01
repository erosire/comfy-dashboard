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

// InputToggle — the "Input" chip in the card header. Marks the field as a
// workflow Input: an external data entry point the result viewer can feed
// (a Universal Data Input receives the viewed image's base64 stream). It
// is a real button and stops propagation, so toggling it never triggers
// the header's remove-from-PROMPT action. Active: accent chip; inactive:
// ghost outline that brightens on hover.
const InputToggle = styled('button', {
    shouldForwardProp: (prop) => prop !== 'active'
})<{ active: boolean }>(({ active }) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1px 7px',
    flex: '0 0 auto',
    borderRadius: theme.radiusSm,
    border: `1px solid ${active ? theme.accent : theme.border}`,
    backgroundColor: active ? theme.accentSoft : 'transparent',
    color: active ? theme.accent : theme.textFaint,
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    fontWeight: 600,
    lineHeight: 1.4,
    cursor: 'pointer',
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`,
    '&:hover': {
        borderColor: theme.accent,
        color: theme.accent,
        backgroundColor: active ? theme.accentSoft : theme.surface3
    }
}));

export type PromptFieldsPaneProps = {
    entries: PromptWidgetRef[];
    togglePromptField: (node: UINode, widgetIdx: number) => void;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    /** Keys of widgets marked as workflow Inputs (external data entry points). */
    inputFields: Set<string>;
    /** Toggle a field's Input marking (persisted via Save). */
    toggleInputField: (node: UINode, widgetIdx: number) => void;
};

export const PromptFieldsPane: React.FC<PromptFieldsPaneProps> = ({ entries, togglePromptField, updateNodeWidget, inputFields, toggleInputField }) => (
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
                                {/* Input marking — declares the field an
                                    external data entry point. Workflows
                                    with Inputs appear in the image
                                    preview's workflow dropdown; picking
                                    one feeds the viewed image's base64
                                    stream into the marked Data URI
                                    (Universal Data Input) fields and
                                    triggers a run. */}
                                <InputToggle
                                    active={inputFields.has(key)}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        toggleInputField(node, widget.index);
                                    }}
                                    title={
                                        inputFields.has(key)
                                            ? 'Unmark as Input — the preview will no longer feed data into this field'
                                            : 'Mark as Input — the image preview can feed its base64 stream into this field (Save to persist)'
                                    }
                                    data-testid={`prompt-field-input-${key}`}
                                >
                                    Input
                                </InputToggle>
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
