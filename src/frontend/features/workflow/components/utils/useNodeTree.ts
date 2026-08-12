// Editor node tree state + widget/bypass editing.
//
// The editor tree (UINode[]) is the source of truth while the user edits:
// widget edits and bypass toggles mutate only the tree, which drives both
// Generate (editorTreeToApiPrompt) and Save (applyWidgetEditsToRaw).
// Subgraph nesting is handled by recursively walking the tree.
//
// Extracted from the original CloudTab.tsx updateNodeWidget / toggleNodeBypass.

import React from 'react';
import { comfyNodeRegistry, type UINode } from '@underload/comfy';
import { parseInputValue } from './widget-utils';

export function useNodeTree() {
    const [nodes, setNodes] = React.useState<UINode[]>([]);

    // ── Node editing ─────────────────────────────────────────────────

    const updateNodeWidget = React.useCallback((nodeId: string, widgetIdx: number, rawValue: string) => {
        /** Recursively update a widget in a node tree (handles subgraph nesting). */
        const updateInTree = (nodes: UINode[]): UINode[] =>
            nodes.map((n) => {
                if (n.id === nodeId) {
                    const def = comfyNodeRegistry[n.classType]?.widgets[widgetIdx];
                    const widgets = n.widgets.map((w, i) =>
                        i === widgetIdx ? { ...w, value: parseInputValue(rawValue, w.value, def) } : w
                    );
                    return { ...n, widgets };
                }
                if (n.subgraphNodes && n.subgraphNodes.length > 0) {
                    return { ...n, subgraphNodes: updateInTree(n.subgraphNodes) };
                }
                return n;
            });
        setNodes((prev) => updateInTree(prev));
    }, []);

    // ── Bypass toggling ─────────────────────────────────────────────
    // Every node card header carries a mode toggle: click to switch the
    // node between active (mode 0) and bypassed (mode 4) — the same
    // semantics as ComfyUI's right-click → Bypass. A bypassed/disabled
    // node is excluded from the API prompt entirely (see
    // uiNodesToApiPrompt), so the toggle directly controls what the pod
    // executes. The editor tree is the source of truth: toggling affects
    // Generate immediately, and Save persists the mode into the stored
    // workflow json (applyWidgetEditsToRaw).
    const toggleNodeBypass = React.useCallback((nodeId: string) => {
        /** Recursively toggle a node's mode in a tree (handles subgraph nesting). */
        const updateInTree = (nodes: UINode[]): UINode[] =>
            nodes.map((n) => {
                if (n.id === nodeId) {
                    return { ...n, mode: n.mode === 4 ? 0 : 4 };
                }
                if (n.subgraphNodes && n.subgraphNodes.length > 0) {
                    return { ...n, subgraphNodes: updateInTree(n.subgraphNodes) };
                }
                return n;
            });
        setNodes((prev) => updateInTree(prev));
    }, []);

    return { nodes, setNodes, updateNodeWidget, toggleNodeBypass };
}
