// PromptFieldsPane — the PROMPT tab: a compact list of every field toggled
// on the JSON side, in workflow (display) order. Edits write into the same
// tree state the JSON tab shows.
//
// Extracted verbatim from the original CloudTab.tsx PROMPT tab body.

import React from 'react';
import { theme } from '../../../styles';
import { comfyNodeRegistry, getWidgetLabel } from '../../../../comfy';
import type { UINode } from '../../../nodes/node-type';
import { nodeDisplayName, type PromptWidgetRef } from './utils';
import { InputLabel, InputRow } from './ui';
import { WidgetValueEditor } from './WidgetValueEditor';

export type PromptFieldsPaneProps = {
    entries: PromptWidgetRef[];
    togglePromptField: (node: UINode, widgetIdx: number) => void;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
};

export const PromptFieldsPane: React.FC<PromptFieldsPaneProps> = ({ entries, togglePromptField, updateNodeWidget }) => (
    <div data-testid="prompt-tab-pane">
        {entries.length === 0 ? (
            <div
                style={{
                    fontSize: theme.fontSize.sm,
                    color: theme.textFaint,
                    padding: '20px 4px'
                }}
            >
                No fields selected — click a field label in the JSON tab to add it here.
            </div>
        ) : (
            entries.map(({ key, node, widget }) => (
                <InputRow key={key} style={{ alignItems: 'flex-start', marginBottom: 6 }}>
                    <InputLabel
                        onClick={() => togglePromptField(node, widget.index)}
                        title={`Remove from the PROMPT tab (${node.title ?? node.classType} #${node.id})`}
                        style={{
                            cursor: 'pointer',
                            userSelect: 'none',
                            color: theme.accent,
                            fontWeight: 600,
                            paddingTop: 4,
                            minWidth: 140
                        }}
                    >
                        {getWidgetLabel(node.classType, widget.index)}
                        <span
                            style={{
                                display: 'block',
                                fontWeight: 400,
                                color: theme.textFaint,
                                fontSize: '0.9em'
                            }}
                        >
                            {nodeDisplayName(node, comfyNodeRegistry[node.classType])} #{node.id}
                        </span>
                    </InputLabel>
                    <WidgetValueEditor
                        node={node}
                        widget={widget}
                        updateNodeWidget={updateNodeWidget}
                        testId={`prompt-widget-${key}`}
                    />
                </InputRow>
            ))
        )}
    </div>
);
