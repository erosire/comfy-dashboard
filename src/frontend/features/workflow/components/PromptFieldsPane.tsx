// PromptFieldsPane — the PROMPT tab: a compact list of every field toggled
// on the JSON side, in workflow (display) order. Edits write into the same
// tree state the JSON tab shows.
//
// Layout: each entry is a two-row block — a header line with the widget
// title on the left and the owning node (name + id) pushed to the far
// right, then the widget editor filling the full pane width beneath it.

import React from 'react';
import { theme } from '../../../styles';
import { comfyNodeRegistry, getWidgetLabel } from '../../../../comfy';
import type { UINode } from '../../../nodes/node-type';
import { nodeDisplayName, type PromptWidgetRef } from './utils';
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
                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 10 }}>
                    {/* Header line: title on the left, owning node on the far
                        right. Clicking it removes the field from the PROMPT
                        tab (same affordance the old side label had). */}
                    <div
                        onClick={() => togglePromptField(node, widget.index)}
                        title={`Remove from the PROMPT tab (${node.title ?? node.classType} #${node.id})`}
                        style={{
                            display: 'flex',
                            alignItems: 'baseline',
                            justifyContent: 'space-between',
                            gap: 8,
                            cursor: 'pointer',
                            userSelect: 'none'
                        }}
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
                            {getWidgetLabel(node.classType, widget.index)}
                        </span>
                        <span
                            style={{
                                fontSize: theme.fontSize.xs,
                                fontFamily: theme.fontMono,
                                color: theme.textFaint,
                                flex: '0 1 auto',
                                minWidth: 0,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                textAlign: 'right'
                            }}
                        >
                            {nodeDisplayName(node, comfyNodeRegistry[node.classType])} #{node.id}
                        </span>
                    </div>
                    {/* Editor line: a flex row so every control type (which
                        all use flex: 1 1 auto) stretches to the full pane
                        width. */}
                    <div style={{ display: 'flex' }}>
                        <WidgetValueEditor
                            node={node}
                            widget={widget}
                            updateNodeWidget={updateNodeWidget}
                            testId={`prompt-widget-${key}`}
                        />
                    </div>
                </div>
            ))
        )}
    </div>
);
