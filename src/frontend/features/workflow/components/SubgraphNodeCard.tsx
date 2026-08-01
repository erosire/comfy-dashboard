// SubgraphNodeCard — renders a UINode with the same card as regular nodes.
//
// Used for the internal nodes of a subgraph (and recursively for deeper
// nesting). Extracted verbatim from the original CloudTab.tsx.

import React from 'react';
import { theme } from '../../../styles';
import { comfyNodeRegistry } from '../../../../comfy';
import type { UINode } from '../../../nodes/node-type';
import {
    dataTypeColor,
    dataTypeLabel,
    modeToggleIcon,
    modeToggleTitle,
    nodeDisplayName,
    nodeDisplayNameTitle,
    promptWidgetKey,
    widgetLabel
} from './utils';
import { InputLabel, InputRow, LinkBadge, ModeToggle, NodeCard, NodeClassType, NodeHeader, NodeId, NodeInputs } from './ui';
import { WidgetValueEditor } from './WidgetValueEditor';

export const SubgraphNodeCard: React.FC<{
    node: UINode;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    toggleNodeBypass: (nodeId: string) => void;
    executingNodeId?: string | null;
    promptFields: Set<string>;
    togglePromptField: (node: UINode, widgetIdx: number) => void;
}> = React.memo(({ node, updateNodeWidget, toggleNodeBypass, executingNodeId, promptFields, togglePromptField }) => {
    const isSubgraph = !!node.subgraphDef;
    const registryEntry = comfyNodeRegistry[node.classType];
    const isUnregistered = !isSubgraph && !registryEntry;
    const isExecuting = node.id === executingNodeId;
    const isBypassed = node.mode === 4;
    return (
        <NodeCard
            style={{
                ...(isExecuting
                    ? {
                          marginLeft: 8,
                          border: `2px solid ${theme.accent}`,
                          backgroundColor: theme.accentSoft,
                          boxShadow: `0 0 12px rgba(129, 140, 248, 0.35)`
                      }
                    : isUnregistered
                      ? { marginLeft: 8, border: `1px solid ${theme.dangerBorder}`, backgroundColor: theme.dangerSoft }
                      : { marginLeft: 8, borderLeft: `2px solid ${theme.accent}30` }),
                // Bypassed nodes render half-transparent as a "not in the prompt" indicator.
                opacity: isBypassed ? 0.25 : undefined
            }}
        >
            <NodeHeader
                style={
                    isExecuting
                        ? { backgroundColor: 'rgba(129, 140, 248, 0.25)' }
                        : isUnregistered
                          ? { backgroundColor: 'rgba(248, 113, 113, 0.20)' }
                          : undefined
                }
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {isExecuting && (
                        <span
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: theme.accent,
                                marginRight: 2
                            }}
                            title="Currently executing"
                        >
                            ▶
                        </span>
                    )}
                    <NodeClassType
                        title={nodeDisplayNameTitle(node)}
                        style={
                            isExecuting ? { color: theme.accent } : isUnregistered ? { color: theme.danger } : undefined
                        }
                    >
                        {nodeDisplayName(node, registryEntry)}
                    </NodeClassType>
                    {isUnregistered && (
                        <span
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: theme.danger,
                                border: `1px solid ${theme.dangerBorder}`,
                                borderRadius: theme.radiusSm,
                                padding: '0 4px',
                                backgroundColor: theme.dangerSoft
                            }}
                        >
                            not registered
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <NodeId>#{node.id}</NodeId>
                    <ModeToggle
                        type="button"
                        bypassed={node.mode === 4}
                        onClick={() => toggleNodeBypass(node.id)}
                        title={modeToggleTitle(node.mode)}
                    >
                        {modeToggleIcon(node.mode)}
                    </ModeToggle>
                </div>
            </NodeHeader>
            <NodeInputs>
                {node.connections.map((conn) => (
                    <InputRow key={`conn-${conn.name}`}>
                        <InputLabel style={{ color: dataTypeColor(conn.type) }}>{conn.name}</InputLabel>
                        <LinkBadge
                            style={{
                                color: dataTypeColor(conn.type),
                                borderColor: `${dataTypeColor(conn.type)}40`,
                                backgroundColor: `${dataTypeColor(conn.type)}12`
                            }}
                        >
                            → {conn.sourceNodeId}[{conn.sourceSlot}]
                            {conn.type !== '*' && (
                                <span style={{ marginLeft: 4, opacity: 0.7, fontSize: '0.9em' }}>
                                    {dataTypeLabel(conn.type)}
                                </span>
                            )}
                        </LinkBadge>
                    </InputRow>
                ))}
                {node.widgets.map((widget) => {
                    const fieldKey = promptWidgetKey(node, widget);
                    const isPromptField = promptFields.has(fieldKey);
                    return (
                        <InputRow key={`w${widget.index}`}>
                            <InputLabel
                                onClick={() => togglePromptField(node, widget.index)}
                                title={isPromptField ? 'Remove from the PROMPT tab' : 'Add to the PROMPT tab'}
                                style={{
                                    cursor: 'pointer',
                                    userSelect: 'none',
                                    color: isPromptField ? theme.accent : undefined,
                                    fontWeight: isPromptField ? 600 : undefined
                                }}
                            >
                                {widgetLabel(node, widget)}
                            </InputLabel>
                            <WidgetValueEditor
                                node={node}
                                widget={widget}
                                updateNodeWidget={updateNodeWidget}
                            />
                        </InputRow>
                    );
                })}
                {node.outputs.length > 0 && (
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap' as const,
                            gap: 4,
                            marginTop: 4,
                            paddingTop: 4,
                            borderTop: `1px solid ${theme.border}`
                        }}
                    >
                        <span
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: theme.textFaint,
                                marginRight: 2
                            }}
                        >
                            outputs:
                        </span>
                        {node.outputs.map((out) => (
                            <span
                                key={`out-${out.slotIndex}`}
                                style={{
                                    fontSize: theme.fontSize.xs,
                                    color: dataTypeColor(out.type),
                                    fontFamily: theme.fontMono,
                                    padding: '0 4px',
                                    borderRadius: theme.radiusSm,
                                    backgroundColor: `${dataTypeColor(out.type)}12`,
                                    border: `1px solid ${dataTypeColor(out.type)}25`
                                }}
                            >
                                {out.name}
                                {out.connectionCount > 0 && (
                                    <span style={{ opacity: 0.6 }}> ({out.connectionCount})</span>
                                )}
                                {out.isList && <span style={{ opacity: 0.6 }}> []</span>}
                            </span>
                        ))}
                    </div>
                )}
                {(node.properties['Node name for S&R'] || node.properties.ver) && (
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap' as const,
                            gap: 6,
                            marginTop: 4,
                            paddingTop: 4,
                            borderTop: `1px solid ${theme.border}`
                        }}
                    >
                        {node.properties['Node name for S&R'] && (
                            <span style={{ fontSize: theme.fontSize.xs, color: theme.textDim }}>
                                S&amp;R: {node.properties['Node name for S&R']}
                            </span>
                        )}
                        {node.properties.ver && (
                            <span style={{ fontSize: theme.fontSize.xs, color: theme.textDim }}>
                                v{node.properties.ver}
                            </span>
                        )}
                        {node.properties.cnr_id && (
                            <span style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}>
                                CNR: {node.properties.cnr_id}
                            </span>
                        )}
                    </div>
                )}
                {node.connections.length === 0 && node.widgets.length === 0 && node.outputs.length === 0 && (
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}>No inputs</div>
                )}
                {/* Recurse into nested subgraphs */}
                {node.subgraphNodes && node.subgraphNodes.length > 0 && (
                    <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${theme.accent}30` }}>
                        <div
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: theme.accent,
                                fontWeight: 600,
                                marginBottom: 4
                            }}
                        >
                            ◈ {node.subgraphNodes.length} internal node{node.subgraphNodes.length !== 1 ? 's' : ''}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {node.subgraphNodes.map((inner) => (
                                <SubgraphNodeCard
                                    key={inner.id}
                                    node={inner}
                                    updateNodeWidget={updateNodeWidget}
                                    toggleNodeBypass={toggleNodeBypass}
                                    executingNodeId={executingNodeId}
                                    promptFields={promptFields}
                                    togglePromptField={togglePromptField}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </NodeInputs>
        </NodeCard>
    );
});
