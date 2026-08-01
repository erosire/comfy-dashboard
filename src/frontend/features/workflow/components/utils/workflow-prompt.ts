// API prompt assembly — flattens the UINode tree (with subgraphs expanded)
// into the flat prompt dict ComfyUI's POST /prompt endpoint expects.
//
// Extracted verbatim from the original CloudTab.tsx.

import { comfyNodeRegistry } from '../../../../../comfy';
import type { UINode } from '../../../../nodes/node-type';
import { parseWorkflowJson } from './workflow-parser';
import { renumberNodes, sortNodesDeep } from './workflow-sort';

/**
 * Assemble a flat API prompt from a list of already-flattened UI nodes.
 *
 * Widget values are emitted first (keyed by their registry name, or by the
 * inferred name for unregistered nodes), then linked connections override
 * them — so a widget that has been converted to a connected input slot
 * sends the link reference, not the stale widget value. A converted
 * widget whose connection was removed (e.g. an unconnected subgraph
 * input port whose -10 sentinel was filtered out) falls back to its
 * widget value, which is the correct ComfyUI behaviour.
 *
 * Disabled (mode 2) and bypassed (mode 4) nodes are never serialized:
 * the API prompt has no mode concept — anything in it is executed by the
 * server as a normal node — so these must be excluded here, exactly like
 * ComfyUI's own frontend does. Connections referencing excluded nodes are
 * dropped with them ("remove inputs connected to removed nodes"), so no
 * dangling [nodeId, slot] references reach the server; a converted-widget
 * input that loses its link this way keeps the widget value emitted
 * above, which matches ComfyUI's fallback semantics.
 */
export function uiNodesToApiPrompt(flat: UINode[]): Record<string, unknown> {
    const active = flat.filter((n) => n.mode !== 2 && n.mode !== 4);
    const activeIds = new Set(active.map((n) => n.id));
    const prompt: Record<string, unknown> = {};
    for (const node of active) {
        const inputs: Record<string, unknown> = {};

        const registryEntry = comfyNodeRegistry[node.classType];

        // ── Widget values (emitted first; connections override below) ──
        // Nodes with dynamic widgets (a registry serializeWidgets hook —
        // e.g. rgthree's Power Lora Loader) own their widget serialization;
        // the positional name mapping cannot describe shifting slots.
        if (registryEntry?.serializeWidgets) {
            Object.assign(inputs, registryEntry.serializeWidgets(node.widgets));
        } else {
            for (const widget of node.widgets) {
                const regWidget = registryEntry?.widgets[widget.index];
                if (regWidget) {
                    inputs[regWidget.name] = widget.value;
                } else if (widget.inferredName) {
                    // Unregistered node — use the name inferred from the
                    // workflow's converted-to-input slots or Record-style
                    // widgets_values keys.
                    inputs[widget.inferredName] = widget.value;
                }
                // Registered nodes with undefined registry widgets (e.g.
                // TemporaryImagePreview's hidden internal widget) are
                // intentionally skipped — they have no API input.
            }
        }

        // ── Linked connections → [sourceNodeId, sourceSlot] ──
        // Processed AFTER widgets so a connected converted-widget input
        // overrides the (stale) widget value. References to excluded
        // (disabled/bypassed) nodes are dropped — a severed widget-input
        // link therefore falls back to the widget value.
        for (const conn of node.connections) {
            if (!activeIds.has(conn.sourceNodeId)) continue;
            inputs[conn.name] = [conn.sourceNodeId, conn.sourceSlot];
        }

        prompt[node.id] = { class_type: node.classType, inputs };
    }
    return prompt;
}

/**
 * Convert a ComfyUI workflow JSON (v0.4 or v1 format) into the flat API
 * prompt format expected by POST /prompt.
 *
 * Workflow format has `nodes`, `links`, `groups`, `definitions`, etc.
 * API prompt format is a flat dict keyed by node ID:
 *   { "3": { "class_type": "KSampler", "inputs": { "seed": ..., "model": ["4", 0] } } }
 *
 * If the input is already in API prompt format, it is returned as-is.
 */
export function workflowToApiPrompt(raw: Record<string, unknown>): Record<string, unknown> {
    // Already in API prompt format (flat dict of {class_type, inputs})?
    if (!Array.isArray(raw.nodes)) {
        return raw;
    }

    const uiNodes = parseWorkflowJson(raw);
    const sorted = sortNodesDeep(uiNodes);
    const renumbered = renumberNodes(sorted);

    // Flatten subgraph nodes into their internal nodes.
    // Subgraph wrapper nodes have a subgraphDef but no real ComfyUI class_type —
    // ComfyUI only understands the internal nodes (VAEDecode, KSampler, etc.).
    return uiNodesToApiPrompt(flattenSubgraphNodes(renumbered));
}

/**
 * Build the API prompt from the CURRENT editor node tree — every widget
 * edit the user made is included. This is the source of truth for
 * Generate: what you see in the UI is exactly what gets snapshotted into
 * the generation json and submitted to the pod.
 */
export function editorTreeToApiPrompt(nodes: UINode[]): Record<string, unknown> {
    return uiNodesToApiPrompt(flattenSubgraphNodes(nodes));
}

/**
 * Recursively flatten subgraph nodes into a flat list of real ComfyUI nodes.
 *
 * Subgraph wrapper nodes (those with `subgraphDef`) are containers — they
 * have no class_type that ComfyUI recognizes. Their internal nodes (stored
 * in `subgraphNodes`) are the real nodes that need to be in the prompt.
 * Internal nodes may themselves be subgraphs (nested), so we recurse.
 *
 * Nodes without subgraphDef pass through as-is.
 *
 * When a subgraph wrapper is removed, we must:
 *   1. Remap connections that reference the wrapper's outputs to the internal
 *      node that actually produces each output (via the -20 outputNode sentinel).
 *   2. Remove connections referencing sentinel nodes (-10, -20) since those are
 *      virtual nodes that don't exist in the flat prompt.
 */
export function flattenSubgraphNodes(nodes: UINode[]): UINode[] {
    // ── First pass: remove wrappers and build output remap tables ─────────
    //
    // For each removed wrapper, we map each of its output slots to the
    // internal renumbered node ID and output slot that produces the data.
    //
    // In subgraph definitions, links TO the -20 sentinel (outputNode) tell us
    // which internal node produces each subgraph output. The subgraph
    // definition's outputs[].linkIds reference these links.
    const outputRemaps = new Map<string, Map<number, { nodeId: string; slot: number }>>();
    const result: UINode[] = [];

    for (const node of nodes) {
        if (node.subgraphDef && node.subgraphNodes && node.subgraphNodes.length > 0) {
            // Build output port → internal producer mapping
            const outputMap = new Map<number, { nodeId: string; slot: number }>();
            const subgraphLinks = node.subgraphLinks ?? [];
            const sgDef = node.subgraphDef;

            // Build a mapping from original internal node IDs → renumbered IDs.
            // After renumberSubgraphNodes, each internal node's _raw.id holds
            // the original ID and its .id holds the renumbered ID (e.g. "2-1").
            const origToRenumbered = new Map<string, string>();
            for (const internalNode of node.subgraphNodes) {
                const origId = internalNode._raw?.id;
                if (origId != null) {
                    origToRenumbered.set(String(origId), internalNode.id);
                }
            }

            for (const sgOutput of sgDef.outputs ?? []) {
                for (const linkId of sgOutput.linkIds ?? []) {
                    // Find the internal link that goes TO the -20 outputNode
                    const link = subgraphLinks.find((l) => l.id === linkId && String(l.target_id) === '-20');
                    if (link) {
                        const origSourceId = String(link.origin_id);
                        const renumberedSourceId = origToRenumbered.get(origSourceId);
                        if (renumberedSourceId) {
                            outputMap.set(Number(link.target_slot), {
                                nodeId: renumberedSourceId,
                                slot: Number(link.origin_slot)
                            });
                        }
                    }
                }
            }

            if (outputMap.size > 0) {
                outputRemaps.set(node.id, outputMap);
            }

            // Recursively flatten internal nodes (handles nested subgraphs)
            result.push(...flattenSubgraphNodes(node.subgraphNodes));
        } else {
            result.push(node);
        }
    }

    // ── Second pass: rewire connections referencing removed wrappers ──────
    //
    // Any connection whose sourceNodeId points to a removed subgraph wrapper
    // needs to be redirected to the internal node that produces that output.
    // Connections referencing sentinel nodes (-10, -20) are removed since
    // those virtual nodes don't exist in the flat prompt.
    for (const node of result) {
        node.connections = node.connections
            // Remove sentinel references (-10 = inputNode, -20 = outputNode)
            .filter((conn) => conn.sourceNodeId !== '-10' && conn.sourceNodeId !== '-20')
            .map((conn) => {
                const remap = outputRemaps.get(conn.sourceNodeId);
                if (remap) {
                    const target = remap.get(conn.sourceSlot);
                    if (target) {
                        return { ...conn, sourceNodeId: target.nodeId, sourceSlot: target.slot };
                    }
                }
                return conn;
            });
    }

    return result;
}
