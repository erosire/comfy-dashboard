// API prompt assembly — flattens the UINode tree (with subgraphs expanded)
// into the flat prompt dict ComfyUI's POST /prompt endpoint expects.
//
// Extracted verbatim from the original CloudTab.tsx.

import {
    isBoolean,
    isInvalid,
    isNumber,
    isObject,
    isString,
    jsonStringify,
    objectEach,
    objectHasKey,
    toString
} from '@presource/core';
import { comfyNodeRegistry, type DataType } from '@underload/comfy';
import type { UIInputConnection, UINode } from '../../../../nodes/node-type';
import { parseWorkflowJson } from './workflow-parser';
import { renumberNodes, sortNodesDeep } from './workflow-sort';

// Preference API responses are version maps (`{ current: value }`), while the
// resolver also accepts scalar values so callers can compile a prompt from a
// small in-memory map without first wrapping every value in `current`.
export type PromptPreferences = Record<string, unknown>;

// Only balanced double-brace tokens are variables. Invalid or unmatched braces
// are left alone because they are ordinary user text rather than a variable
// declaration that this compiler can resolve safely.
const PREFERENCE_TOKEN_PATTERN = /\{\{([^{}]+)\}\}/g;
const COMPLETE_PREFERENCE_TOKEN_PATTERN = /^\{\{([^{}]+)\}\}$/;

// Read the value selected for one preference variable. `current` is the
// canonical version; when it is absent, the first persisted version is used so
// profiles containing only a custom revision still provide a deterministic
// replacement. A missing or null variable resolves to the required empty text.
const readPromptPreference = (
    preferences: PromptPreferences,
    name: string
): { exists: boolean; value: unknown } => {
    if (!objectHasKey(preferences, name)) return { exists: false, value: '' };

    const configured = preferences[name];
    if (isInvalid(configured)) return { exists: false, value: '' };
    if (!isObject(configured)) return { exists: true, value: configured };

    if (objectHasKey(configured, 'current')) {
        const current = configured.current;
        return isInvalid(current) ? { exists: false, value: '' } : { exists: true, value: current };
    }

    let firstVersion: unknown;
    let hasVersion = false;
    objectEach(configured, ({ value }) => {
        if (!hasVersion) {
            firstVersion = value;
            hasVersion = true;
        }
    });
    return hasVersion && !isInvalid(firstVersion)
        ? { exists: true, value: firstVersion }
        : { exists: false, value: '' };
};

// Convert a resolved non-string value into text when it is embedded inside a
// larger string. JSON encoding keeps objects and arrays valid rather than
// producing the unhelpful `[object Object]` token in a prompt field.
const promptReplacementText = (value: unknown): string => {
    if (isInvalid(value)) return '';
    if (isString(value)) return value;
    if (isNumber(value) || isBoolean(value)) return toString(value);
    try {
        return jsonStringify(value) ?? '';
    } catch {
        // Cyclic or otherwise non-serializable preference values cannot be
        // represented in a JSON payload, so the same safe fallback as a
        // missing preference prevents invalid prompt data from escaping.
        return '';
    }
};

// Resolve a preference value recursively. This handles a preference referring
// to another preference and breaks cycles by replacing the cyclic edge with an
// empty string, guaranteeing that resolved prompt strings contain no tokens
// introduced by another preference value.
const resolvePromptValue = (
    value: unknown,
    preferences: PromptPreferences,
    resolving: Set<string>
): unknown => {
    if (isString(value)) {
        const complete = value.match(COMPLETE_PREFERENCE_TOKEN_PATTERN);
        if (complete) {
            const name = complete[1].trim();
            const preference = readPromptPreference(preferences, name);
            if (!preference.exists || resolving.has(name)) return '';
            const nextResolving = new Set(resolving);
            nextResolving.add(name);
            return resolvePromptValue(preference.value, preferences, nextResolving);
        }

        return value.replace(PREFERENCE_TOKEN_PATTERN, (_token, rawName: string) => {
            const name = rawName.trim();
            const preference = readPromptPreference(preferences, name);
            if (!preference.exists || resolving.has(name)) return '';
            const nextResolving = new Set(resolving);
            nextResolving.add(name);
            return promptReplacementText(resolvePromptValue(preference.value, preferences, nextResolving));
        });
    }

    if (Array.isArray(value)) {
        return value.map((item) => resolvePromptValue(item, preferences, resolving));
    }

    if (isObject(value)) {
        const resolved: Record<string, unknown> = {};
        objectEach(value, ({ key, value: nested }) => {
            // JSON object keys are always strings, so object-valued key
            // replacements are encoded in the same safe form as embedded text.
            const resolvedKey = resolvePromptValue(key, preferences, resolving);
            resolved[promptReplacementText(resolvedKey)] = resolvePromptValue(nested, preferences, resolving);
        });
        return resolved;
    }

    // Numbers, booleans, and null-free JSON primitives are already valid JSON
    // values and must retain their type when they are the complete token.
    return value;
};

// Replace every preference token in a JSON-compatible value. The recursive
// result is a fresh structure, so compiling a prompt never mutates the saved
// workflow snapshot or the editor's node tree.
export const replacePreferenceVariables = <T>(
    value: T,
    preferences: PromptPreferences = {}
): T => resolvePromptValue(value, preferences, new Set()) as T;

// ── Bypass rejoin (mode 4 pass-through) ─────────────────────────────────────
//
// ComfyUI's stored bypass semantic is "inputs pass directly to outputs
// unchanged" (LGraphEventMode.BYPASS, comfy/node-structure.ts:192). A
// bypassed node must still disappear from the API prompt (the server
// executes anything it contains — there is no mode concept), but wires
// crossing it must not be lost: when the bypassed node has a connected
// input whose type matches the output slot a downstream node consumes, the
// downstream connection is rejoined to the bypassed node's upstream source
// instead of being dropped.

/** Normalize a slot DataType (string | string[] | number, comfy/node-structure.ts:42) into one comparable key. */
const slotTypeKey = (type: DataType | undefined): string =>
    Array.isArray(type) ? type.join('|') : String(type ?? '*');

/**
 * Find the connected input of a bypassed node that passes data through to
 * the output slot type a downstream node consumes — the bypassed node acts
 * as a wire for that type, so the downstream connection rejoins to whatever
 * feeds this input.
 *
 * Declared slot types come from the raw workflow node (`UINode._raw.inputs`)
 * because a UIInputConnection's `type` is the *link's* dataType (set by the
 * producing end of the wire — see resolveConnections in workflow-parser.ts:298),
 * not the input slot's own declaration. When the raw node is unavailable
 * (hand-built UINodes) the link type is the best remaining proxy.
 *
 * Exact type equality wins first; a '*' (any) input is only a fallback —
 * wildcard inputs genuinely accept any type, but a node with both an exact
 * and a wildcard input must rejoin through the exact one. A wildcard
 * *output* never matches concrete input types: with several concrete inputs
 * present, picking one arbitrarily would be wrong.
 */
const findBypassPassThroughInput = (node: UINode, outputType: DataType): UIInputConnection | null => {
    const declaredInputs = node._raw?.inputs ?? [];
    const outputKey = slotTypeKey(outputType);
    let wildcard: UIInputConnection | null = null;
    for (const conn of node.connections) {
        const inputType = declaredInputs.find((i) => i.name === conn.name)?.type ?? conn.type;
        const inputKey = slotTypeKey(inputType);
        if (inputKey === outputKey) return conn;
        if (inputKey === '*' && !wildcard) wildcard = conn;
    }
    return wildcard;
};

/**
 * Walk a connection's source through any bypassed (mode 4) nodes between it
 * and the real producer, returning the [nodeId, slot] of the active node
 * that actually feeds the wire. Chains of consecutive bypassed nodes
 * resolve transitively.
 *
 * Returns null when the chain cannot be rejoined: the matching pass-through
 * input is unconnected or wrongly typed, a disabled (mode 2) node sits in
 * the chain (disabled keeps the plain exclude-and-drop behavior — pass-
 * through is a mode-4 semantic only), the source node id is unknown, or
 * bypassed nodes form a cycle. The caller then drops the input, preserving
 * the "no dangling [nodeId, slot] references" guarantee, and a converted-
 * widget input that loses its link this way keeps its widget value fallback.
 */
const resolveThroughBypassedNodes = (
    sourceNodeId: string,
    sourceSlot: number,
    nodeById: ReadonlyMap<string, UINode>
): { nodeId: string; slot: number } | null => {
    let nodeId = sourceNodeId;
    let slot = sourceSlot;
    // Keyed on id+slot so distinct wires through the same bypassed node
    // still resolve, while a true bypass loop terminates immediately.
    const visited = new Set<string>();
    for (;;) {
        const node = nodeById.get(nodeId);
        if (!node) return null; // Dangling source id — nothing to rejoin to.
        if (node.mode !== 4) {
            // Reached a real node: active nodes are the producer; disabled
            // (mode 2) nodes break the wire (previous plain-exclusion behavior).
            return node.mode === 2 ? null : { nodeId, slot };
        }
        const key = `${nodeId}:${slot}`;
        if (visited.has(key)) return null;
        visited.add(key);
        // The consumed output slot decides which input type may pass through.
        const output = node.outputs.find((o) => o.slotIndex === slot) ?? node.outputs[slot];
        if (!output) return null;
        const upstream = findBypassPassThroughInput(node, output.type);
        if (!upstream) return null;
        nodeId = upstream.sourceNodeId;
        slot = upstream.sourceSlot;
    }
};

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
 * ComfyUI's own frontend does. Bypass is special: ComfyUI defines it as
 * "inputs pass directly to outputs unchanged", so a connection sourcing a
 * bypassed node is rejoined to that node's upstream source whenever a
 * connected input with the same type as the consumed output exists (chains
 * of bypassed nodes resolve transitively — see resolveThroughBypassedNodes).
 * Connections that cannot be rejoined — and every connection sourcing a
 * disabled node — are dropped with the excluded node ("remove inputs
 * connected to removed nodes"), so no dangling [nodeId, slot] references
 * reach the server; a converted-widget input that loses its link this way
 * keeps the widget value emitted above, which matches ComfyUI's fallback
 * semantics.
 */
export function uiNodesToApiPrompt(flat: UINode[]): Record<string, unknown> {
    const active = flat.filter((n) => n.mode !== 2 && n.mode !== 4);
    // Index EVERY node (including excluded ones) so connection resolution
    // can walk through bypassed intermediates to the real producer.
    const nodeById = new Map(flat.map((n) => [n.id, n]));
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

        // Updated ComfyUI nodes can add required inputs after workflows have
        // already been saved. Apply only the node-specific compatibility
        // defaults declared by the registry, and never replace an explicit
        // widget value; linked connections below still take final precedence.
        if (registryEntry?.promptDefaults) {
            objectEach(registryEntry.promptDefaults, ({ key, value }) => {
                if (!objectHasKey(inputs, key)) inputs[key] = value;
            });
        }

        // ── Linked connections → [sourceNodeId, sourceSlot] ──
        // Processed AFTER widgets so a connected converted-widget input
        // overrides the (stale) widget value. Sources pointing at bypassed
        // (mode 4) nodes are rejoined through them when the slot types
        // match (see resolveThroughBypassedNodes above); sources that
        // cannot be rejoined — including anything fed by a disabled
        // (mode 2) node — are dropped, so a severed widget-input link
        // falls back to the widget value.
        for (const conn of node.connections) {
            const resolved = resolveThroughBypassedNodes(conn.sourceNodeId, conn.sourceSlot, nodeById);
            if (!resolved) continue;
            inputs[conn.name] = [resolved.nodeId, resolved.slot];
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
 * If the input is already in API prompt format, it is returned as-is. Preference
 * replacement is deliberately a separate frontend step so the server receives
 * one already-prepared workflow document and remains responsible only for the
 * workflow-to-API conversion.
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
