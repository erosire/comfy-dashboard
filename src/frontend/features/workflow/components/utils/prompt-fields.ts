// ── PROMPT tab field selection ────────────────────────────────────────
//
// Every widget label in the JSON node layout is a toggle: clicking it adds
// (or removes) that field from the PROMPT tab, which offers a compact list
// of just the chosen fields — the quick way to tweak a long workflow
// without scrolling. The selection is stored in the workflow json itself
// (extra.promptFields — ComfyUI tolerates and preserves unknown extra keys)
// so it rides along with Save and is restored on the next load.
//
// Extracted verbatim from the original CloudTab.tsx.

import { comfyNodeRegistry } from '../../../../../comfy';
import type { UINode, UIWidget } from '../../../../nodes/node-type';
import type { PromptWidgetRef } from './types';

/** Where the selection lives inside the workflow json's `extra` object. */
export const PROMPT_FIELDS_EXTRA_KEY = 'promptFields' as const;

/**
 * Stable key for a widget: "<nodeId>:<apiInputName>". The registry input
 * name is preferred (it is the canonical API key); unregistered nodes fall
 * back to the inferred name, then to a positional key. The node id portion
 * is produced at parse time and is deterministic for a given workflow json,
 * so saved keys re-resolve after every load of that same json.
 */
export function promptWidgetKey(node: UINode, widget: UIWidget): string {
    const name =
        comfyNodeRegistry[node.classType]?.widgets[widget.index]?.name ??
        widget.inferredName ??
        `widget_${widget.index}`;
    return `${node.id}:${name}`;
}

/** Flatten the editor tree (recursing into subgraphs) into every widget, in display order. */
export function collectPromptWidgets(nodes: UINode[]): Map<string, PromptWidgetRef> {
    const map = new Map<string, PromptWidgetRef>();
    const walk = (list: UINode[]): void => {
        for (const node of list) {
            for (const widget of node.widgets) {
                const key = promptWidgetKey(node, widget);
                if (!map.has(key)) map.set(key, { key, node, widget });
            }
            if (node.subgraphNodes && node.subgraphNodes.length > 0) {
                walk(node.subgraphNodes);
            }
        }
    };
    walk(nodes);
    return map;
}

/** Read the saved selection from raw.extra, dropping keys that no longer exist in the tree. */
export function readSavedPromptFields(raw: Record<string, unknown>, nodes: UINode[]): Set<string> {
    const saved = (raw.extra as Record<string, unknown> | undefined)?.[PROMPT_FIELDS_EXTRA_KEY];
    if (!Array.isArray(saved)) return new Set();
    const valid = collectPromptWidgets(nodes);
    const set = new Set<string>();
    for (const key of saved) {
        if (typeof key === 'string' && valid.has(key)) set.add(key);
    }
    return set;
}

/** Copy of raw with the selection stored under extra (removed entirely when empty). */
export function writePromptFieldsToRaw(raw: Record<string, unknown>, fields: Set<string>): Record<string, unknown> {
    const extra = { ...((raw.extra as Record<string, unknown> | undefined) ?? {}) };
    if (fields.size > 0) {
        extra[PROMPT_FIELDS_EXTRA_KEY] = [...fields].sort();
    } else {
        delete extra[PROMPT_FIELDS_EXTRA_KEY];
    }
    const clone: Record<string, unknown> = { ...raw };
    if (Object.keys(extra).length > 0) {
        clone.extra = extra;
    } else {
        delete clone.extra;
    }
    return clone;
}
