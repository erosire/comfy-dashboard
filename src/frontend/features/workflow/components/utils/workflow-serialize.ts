// Workflow serialization — writes the editor tree's widget edits back into
// a raw workflow JSON (v0.4 / v1 / API prompt shapes) for saving.
//
// Extracted verbatim from the original CloudTab.tsx.

import type { WorkflowNode } from '@underload/comfy';
import type { UINode } from '../../../../nodes/node-type';
import { editorTreeToApiPrompt } from './workflow-prompt';

/**
 * Serialize the editor tree's widget edits back into a raw workflow JSON.
 *
 * The editor tree (UINode[]) is the source of truth while the user edits —
 * `updateNodeWidget` mutates only the tree, never `rawJson`. The Save
 * button needs those edits persisted in the stored workflow format, so this
 * deep-clones the raw JSON, locates each edited node's origin (via
 * `_raw.id`, and via the shared subgraph definition for internal nodes),
 * and writes widget values back in the exact shape they were read from
 * (array `widgets_values`, Record `widgets_values`, or API-prompt `inputs`).
 * Execution-mode changes (bypass toggles) ride along the same lookup.
 *
 * Everything else (positions, links, groups, definitions) passes through
 * untouched, and unlinked nodes that the execution sort dropped from the
 * tree remain in the clone as-is.
 */
export function applyWidgetEditsToRaw(raw: Record<string, unknown>, nodes: UINode[]): Record<string, unknown> {
    const clone = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

    /** Write a node's edited widget values back into its raw representation. */
    const writeWidgetsBack = (rawNode: Record<string, unknown>, uiNode: UINode): void => {
        if (uiNode.widgets.length === 0) return;
        const widgetsValues = rawNode.widgets_values;
        if (Array.isArray(widgetsValues)) {
            for (const widget of uiNode.widgets) {
                if (widget.index < widgetsValues.length) {
                    widgetsValues[widget.index] = widget.value;
                }
            }
        } else if (widgetsValues && typeof widgetsValues === 'object') {
            const record = widgetsValues as Record<string, unknown>;
            const keys = Object.keys(record);
            for (const widget of uiNode.widgets) {
                const key = widget.inferredName ?? keys[widget.index];
                if (key != null) record[key] = widget.value;
            }
        }
    };

    /** Write a node's execution mode back (bypass toggles persist with Save). */
    const writeModeBack = (rawNode: Record<string, unknown>, uiNode: UINode): void => {
        const rawMode = typeof rawNode.mode === 'number' ? rawNode.mode : 0;
        if (rawMode !== uiNode.mode) rawNode.mode = uiNode.mode;
    };

    if (Array.isArray(clone.nodes)) {
        // ── Workflow format (v0.4 / v1) ──────────────────────────────
        const applyList = (uiNodes: UINode[], rawList: WorkflowNode[]): void => {
            for (const uiNode of uiNodes) {
                const rawNode = rawList.find((n) => String(n?.id) === String(uiNode._raw?.id));
                if (rawNode) {
                    writeWidgetsBack(rawNode as Record<string, unknown>, uiNode);
                    writeModeBack(rawNode as Record<string, unknown>, uiNode);
                }
                // Recurse into subgraph definitions — internal node edits
                // live on the shared definition (matched by the wrapper's
                // UUID type). Definitions are global to the workflow, so
                // any nesting depth resolves against the same list.
                if (uiNode.subgraphNodes && uiNode.subgraphNodes.length > 0) {
                    const defs = (clone.definitions as any)?.subgraphs;
                    const sgId = uiNode.subgraphDef?.id ?? (uiNode._raw?.type as string | undefined);
                    const def = Array.isArray(defs) ? defs.find((sg: any) => sg?.id === sgId) : undefined;
                    if (def && Array.isArray(def.nodes)) {
                        applyList(uiNode.subgraphNodes, def.nodes as WorkflowNode[]);
                    }
                }
            }
        };

        applyList(nodes, clone.nodes as WorkflowNode[]);
        return clone;
    }

    // ── API prompt format ────────────────────────────────────────────
    // The renumbered tree's ids no longer match the original dict keys, so
    // regenerate the whole prompt from the tree — byte-for-byte what
    // Generate submits — then swap out the node entries while preserving
    // any non-node keys (extra, config, ...).
    const regenerated = editorTreeToApiPrompt(nodes);
    if ('prompt' in clone && typeof clone.prompt === 'object' && clone.prompt !== null) {
        clone.prompt = regenerated;
    } else {
        for (const key of Object.keys(clone)) {
            const value = clone[key];
            if (value && typeof value === 'object' && 'class_type' in value) {
                delete clone[key];
            }
        }
        Object.assign(clone, regenerated);
    }
    return clone;
}
