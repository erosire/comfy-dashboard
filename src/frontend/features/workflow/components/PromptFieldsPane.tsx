// PromptFieldsPane — the PROMPT tab: a compact list of every field toggled
// on the JSON side, in workflow (display) order. Edits write into the same
// tree state the JSON tab shows.
//
// Each card exposes a display-only editable label. The stable widget key and
// actual widget value remain separate, so renaming is safe for serialization.
// Removal is intentionally bound only to the compact ✕ button rather than the
// entire header, preventing accidental deletion while editing or selecting a
// label.

import React from 'react';
import { styledComponent } from '@presource/react';
import { theme } from '../../../styles';
import { comfyNodeRegistry } from '@underload/comfy';
import type { UINode } from '../../../nodes/node-type';
import { nodeDisplayName, widgetLabel, type PromptFieldLabelMap, type PromptWidgetRef } from './utils';
import { WidgetValueEditor } from './WidgetValueEditor';
import { EmptyHint, NodeCard, NodeHeader, NodeId, NodeInputs, NodeList } from './ui';

// The header is a neutral layout band. The explicit remove button below is
// styled independently so the complete band is never a delete target.
const PromptFieldHeader = styledComponent(NodeHeader, {
    userSelect: 'none' as const,
    transition: `background-color ${theme.transition}`
});

// Only this button removes a field from the PROMPT tab. Its dimensions are
// limited to the glyph so surrounding metadata and the editable label remain
// non-destructive click areas.
const PromptFieldRemove = styledComponent('button', {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 18,
    padding: 0,
    boxSizing: 'border-box' as const,
    flex: '0 0 auto',
    borderRadius: theme.radiusSm,
    border: `1px solid transparent`,
    color: theme.textFaint,
    backgroundColor: 'transparent',
    fontSize: theme.fontSize.xs,
    lineHeight: 1,
    cursor: 'pointer',
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`
}) as unknown as React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>>;

// The label input is controlled by the editor's display-label map and does
// not alter the widget's API name or value. Clearing it restores the built-in
// label through the fallback in the render expression below.
const PromptFieldLabelInput = styledComponent('input', {
    flex: '0 1 auto',
    minWidth: 80,
    maxWidth: 260,
    padding: '2px 5px',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.accent,
    fontWeight: 600,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none',
    boxSizing: 'border-box' as const
}) as unknown as React.FC<React.InputHTMLAttributes<HTMLInputElement>>;

// Header metadata stays right-aligned while the label input uses the left
// side of the flex row and remains independently editable.
const PromptFieldMeta = styledComponent('div', {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flex: '0 1 auto',
    minWidth: 0
});

const PromptFieldNodeName = styledComponent('span', {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.textDim,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    textAlign: 'right' as const
});

const PromptFieldBody = styledComponent('div', {
    display: 'flex'
});

// InputToggle marks a prompt field as an external data entry point. It is a
// separate button and stops propagation so it cannot remove the card.
const InputToggle = styledComponent<{ active: boolean }>('button', {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '1px 7px',
    flex: '0 0 auto',
    borderRadius: theme.radiusSm,
    border: ({ active }) => `1px solid ${active ? theme.accent : theme.border}`,
    backgroundColor: ({ active }) => (active ? theme.accentSoft : 'transparent'),
    color: ({ active }) => (active ? theme.accent : theme.textFaint),
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    fontWeight: 600,
    lineHeight: 1.4,
    cursor: 'pointer',
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`
}) as unknown as React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }>;

export type PromptFieldsPaneProps = {
    entries: PromptWidgetRef[];
    /** Display-only custom labels keyed by each stable widget key. */
    promptFieldLabels: PromptFieldLabelMap;
    togglePromptField: (node: UINode, widgetIdx: number) => void;
    /** Persists one user-edited display label in editor state. */
    updatePromptFieldLabel: (key: string, label: string) => void;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    /** Keys of widgets marked as workflow Inputs (external data entry points). */
    inputFields: Set<string>;
    /** Toggle a field's Input marking (persisted via Save). */
    toggleInputField: (node: UINode, widgetIdx: number) => void;
};

export const PromptFieldsPane: React.FC<PromptFieldsPaneProps> = ({
    entries,
    promptFieldLabels,
    togglePromptField,
    updatePromptFieldLabel,
    updateNodeWidget,
    inputFields,
    toggleInputField
}) => (
    <div data-testid="prompt-tab-pane">
        {entries.length === 0 ? (
            <EmptyHint>
                No fields selected — click a field label in the JSON tab to add it here.
            </EmptyHint>
        ) : (
            <NodeList>
                {entries.map(({ key, node, widget }) => {
                    const defaultLabel = widgetLabel(node, widget);
                    return (
                        <NodeCard key={key} data-testid={`prompt-field-${key}`}>
                            {/* The label is editable; only the explicit remove
                                button below invokes togglePromptField. */}
                            <PromptFieldHeader data-testid={`prompt-field-header-${key}`}>
                                <PromptFieldLabelInput
                                    type="text"
                                    value={promptFieldLabels.has(key) ? promptFieldLabels.get(key)! : defaultLabel}
                                    onChange={(event) => updatePromptFieldLabel(key, event.target.value)}
                                    aria-label={`PROMPT label for ${defaultLabel}`}
                                    title="Rename this PROMPT field label"
                                    data-testid={`prompt-field-label-${key}`}
                                />
                                <PromptFieldMeta>
                                    <PromptFieldNodeName>
                                        {nodeDisplayName(node, comfyNodeRegistry[node.classType])}
                                    </PromptFieldNodeName>
                                    <NodeId>#{node.id}</NodeId>
                                    {/* Input marking remains a separate
                                        control so it cannot remove the card. */}
                                    <InputToggle
                                        active={inputFields.has(key)}
                                        onClick={(event) => {
                                            event.stopPropagation();
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
                                    <PromptFieldRemove
                                        type="button"
                                        className="pf-remove"
                                        onClick={() => togglePromptField(node, widget.index)}
                                        title={`Remove from the PROMPT tab (${node.title ?? node.classType} #${node.id})`}
                                        aria-label={`Remove ${defaultLabel} from the PROMPT tab`}
                                        data-testid={`prompt-field-remove-${key}`}
                                    >
                                        ✕
                                    </PromptFieldRemove>
                                </PromptFieldMeta>
                            </PromptFieldHeader>
                            {/* The editor body remains a flex row so every
                                widget control fills the available card width. */}
                            <NodeInputs>
                                <PromptFieldBody>
                                    <WidgetValueEditor
                                        node={node}
                                        widget={widget}
                                        updateNodeWidget={updateNodeWidget}
                                        testId={`prompt-widget-${key}`}
                                    />
                                </PromptFieldBody>
                            </NodeInputs>
                        </NodeCard>
                    );
                })}
            </NodeList>
        )}
    </div>
);
