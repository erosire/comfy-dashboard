// JsonNodePane — the JSON tab: the workflow node layout, one card per node.
//
// Extracted verbatim from the original CloudTab.tsx JSON tab body.

import React from 'react';
import type { UINode } from '../../../nodes/node-type';
import { WorkflowNodeCard } from './WorkflowNodeCard';

export type JsonNodePaneProps = {
    nodes: UINode[];
    promptFields: Set<string>;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    toggleNodeBypass: (nodeId: string) => void;
    togglePromptField: (node: UINode, widgetIdx: number) => void;
};

export const JsonNodePane: React.FC<JsonNodePaneProps> = ({
    nodes,
    promptFields,
    updateNodeWidget,
    toggleNodeBypass,
    togglePromptField
}) => (
    <>
        {nodes.map((node) => (
            <WorkflowNodeCard
                key={node.id}
                node={node}
                promptFields={promptFields}
                updateNodeWidget={updateNodeWidget}
                toggleNodeBypass={toggleNodeBypass}
                togglePromptField={togglePromptField}
            />
        ))}
    </>
);
