// ── Workflow "Input" fields ───────────────────────────────────────────
//
// Any field on the PROMPT tab can be marked as an "Input" — a declaration
// that the field is an external data entry point for the workflow. The
// marking is stored in the workflow json itself (extra.inputFields — same
// convention as extra.promptFields; ComfyUI tolerates and preserves
// unknown extra keys) so it rides along with Save and is restored on load.
//
// The result viewer uses these markings: every saved workflow whose
// extra.inputFields is non-empty appears in the preview's workflow
// dropdown (the list endpoint surfaces the marking as meta.inputFields so
// no per-workflow fetch is needed). Picking one feeds the viewed image
// into the workflow's marked fields and triggers a run.
//
// Data URI input (specifically the ComfyUI-CloudClient Universal Data
// Input — UniversalDataToImage / UniversalDataToAudioVideo, widget
// `data_uri`) takes the image's base64 data stream: the viewed image's
// bytes are fetched, base64-encoded and written as a
// `data:<mime>;base64,...` URI into every marked string-valued widget
// before the run is submitted. Non-string marked widgets (numbers,
// booleans) are skipped — a base64 stream is not a valid value for them.

import type { UINode } from '../../../../nodes/node-type';
import { collectPromptWidgets, promptWidgetKey } from './prompt-fields';
import { parseWorkflowJson } from './workflow-parser';
import { renumberNodes, sortNodesDeep } from './workflow-sort';
import { applyWidgetEditsToRaw } from './workflow-serialize';

/** Where the Input markings live inside the workflow json's `extra` object. */
export const INPUT_FIELDS_EXTRA_KEY = 'inputFields' as const;

/** Read the saved Input markings from raw.extra, dropping keys that no longer exist in the tree. */
export function readSavedInputFields(raw: Record<string, unknown>, nodes: UINode[]): Set<string> {
    const saved = (raw.extra as Record<string, unknown> | undefined)?.[INPUT_FIELDS_EXTRA_KEY];
    if (!Array.isArray(saved)) return new Set();
    const valid = collectPromptWidgets(nodes);
    const set = new Set<string>();
    for (const key of saved) {
        if (typeof key === 'string' && valid.has(key)) set.add(key);
    }
    return set;
}

/** Copy of raw with the Input markings stored under extra (removed entirely when empty). */
export function writeInputFieldsToRaw(raw: Record<string, unknown>, fields: Set<string>): Record<string, unknown> {
    const extra = { ...((raw.extra as Record<string, unknown> | undefined) ?? {}) };
    if (fields.size > 0) {
        extra[INPUT_FIELDS_EXTRA_KEY] = [...fields].sort();
    } else {
        delete extra[INPUT_FIELDS_EXTRA_KEY];
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
 * Build a runnable copy of a workflow with external data fed into its
 * marked Input fields.
 *
 * Re-parses `raw` through the exact same pipeline the editor uses
 * (parse → deep sort → renumber), so the saved extra.inputFields keys
 * re-resolve to their widgets. Every marked widget whose current value is
 * a string receives `dataUri` — this is what a Universal Data Input
 * (`data_uri`) consumes as its base64 data stream. Marked widgets with
 * non-string values are left untouched.
 *
 * Returns null when the workflow has no (resolvable) Input markings, so
 * the caller can surface "this workflow has no Inputs" instead of running
 * an unmodified document.
 */
export function buildWorkflowWithInputs(
    raw: Record<string, unknown>,
    dataUri: string
): Record<string, unknown> | null {
    const nodes = renumberNodes(sortNodesDeep(parseWorkflowJson(raw)));
    const inputKeys = readSavedInputFields(raw, nodes);
    if (inputKeys.size === 0) return null;

    let injected = 0;
    const walk = (list: UINode[]): void => {
        for (const node of list) {
            for (const widget of node.widgets) {
                if (typeof widget.value === 'string' && inputKeys.has(promptWidgetKey(node, widget))) {
                    widget.value = dataUri;
                    injected += 1;
                }
            }
            if (node.subgraphNodes && node.subgraphNodes.length > 0) {
                walk(node.subgraphNodes);
            }
        }
    };
    walk(nodes);
    if (injected === 0) return null;

    // Write the mutated tree back into a clone of the original document —
    // everything else (positions, links, groups, definitions) untouched.
    return applyWidgetEditsToRaw(raw, nodes);
}

/**
 * Fetch media bytes from a streaming URL and return them as a base64 data
 * URI (`data:<mimeType>;base64,...`) — the exact shape a Universal Data
 * Input widget consumes. Reads the response as an ArrayBuffer and encodes
 * in chunks so multi-megabyte results don't blow the call stack.
 */
export async function fetchMediaAsDataUri(url: string, mimeType: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch media bytes (HTTP ${response.status})`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    const CHUNK_SIZE = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
}
