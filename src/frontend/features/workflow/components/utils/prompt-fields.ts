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

import { comfyNodeRegistry, type UINode, type UIWidget } from '@underload/comfy';
import type { PromptWidgetRef } from './types';

/** Where the selection lives inside the workflow json's `extra` object. */
export const PROMPT_FIELDS_EXTRA_KEY = 'promptFields' as const;

/** Where user-defined PROMPT-tab labels live inside the workflow `extra` object. */
export const PROMPT_FIELD_LABELS_EXTRA_KEY = 'promptFieldLabels' as const;

/** User-facing label overrides keyed by the same stable widget keys as `promptFields`. */
export type PromptFieldLabelMap = Map<string, string>;

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

/**
 * Read custom PROMPT-tab labels while dropping labels for widgets that no
 * longer resolve. A malformed `extra.promptFieldLabels` value is ignored so
 * older or externally-authored workflow JSON remains loadable.
 */
export function readSavedPromptFieldLabels(raw: Record<string, unknown>, nodes: UINode[]): PromptFieldLabelMap {
    const saved = (raw.extra as Record<string, unknown> | undefined)?.[PROMPT_FIELD_LABELS_EXTRA_KEY];
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return new Map();

    const valid = collectPromptWidgets(nodes);
    const labels = new Map<string, string>();
    for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
        // Blank labels intentionally mean "use the built-in widget label" and
        // are not retained in state, keeping serialization compact and stable.
        if (valid.has(key) && typeof value === 'string' && value.trim().length > 0) {
            labels.set(key, value.trim());
        }
    }
    return labels;
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

/**
 * Copy of raw with custom PROMPT-tab labels persisted under `extra`. Labels
 * are sorted by stable widget key for deterministic JSON and empty overrides
 * are removed so clearing a rename restores the built-in display label.
 */
export function writePromptFieldLabelsToRaw(
    raw: Record<string, unknown>,
    labels: PromptFieldLabelMap
): Record<string, unknown> {
    const extra = { ...((raw.extra as Record<string, unknown> | undefined) ?? {}) };
    const entries = [...labels.entries()]
        .map(([key, label]) => [key, label.trim()] as const)
        .filter(([, label]) => label.length > 0)
        .sort(([left], [right]) => left.localeCompare(right));

    if (entries.length > 0) {
        const serialized: Record<string, string> = {};
        for (const [key, label] of entries) serialized[key] = label;
        extra[PROMPT_FIELD_LABELS_EXTRA_KEY] = serialized;
    } else {
        delete extra[PROMPT_FIELD_LABELS_EXTRA_KEY];
    }

    const clone: Record<string, unknown> = { ...raw };
    if (Object.keys(extra).length > 0) {
        clone.extra = extra;
    } else {
        delete clone.extra;
    }
    return clone;
}
