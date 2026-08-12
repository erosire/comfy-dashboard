// =============================================================================
// Workflow "Input" markings & preview data-feeding tests
//
// Verifies:
//   1. writeInputFieldsToRaw / readSavedInputFields round-trip through
//      raw.extra.inputFields (stale keys dropped, empty set removed).
//   2. buildWorkflowWithInputs feeds a base64 data URI into every marked
//      string-valued widget — the Universal Data Input (data_uri) case —
//      while skipping marked non-string widgets and leaving everything
//      else (and the original raw) untouched.
//   3. buildWorkflowWithInputs returns null when the workflow declares no
//      (resolvable) Input markings.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseWorkflowJson, renumberNodes, sortNodesDeep } from '@underload/comfy';
import {
    buildWorkflowWithInputs,
    collectPromptWidgets,
    promptWidgetKey,
    readSavedInputFields,
    writeInputFieldsToRaw
} from './components/utils';

const DATA_URI = 'data:image/png;base64,aGVsbG8=';

/** A minimal v1 workflow: a feeder node → PreviewImage sink. */
function makeWorkflow(feeder: Record<string, unknown>): Record<string, unknown> {
    return {
        version: 1,
        nodes: [
            feeder,
            {
                id: 901,
                type: 'PreviewImage',
                pos: [0, 0],
                size: [200, 100],
                flags: {},
                order: 1,
                mode: 0,
                properties: {},
                inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
                outputs: []
            }
        ],
        links: [{ id: 1, origin_id: feeder.id, origin_slot: 0, target_id: 901, target_slot: 0, type: 'IMAGE' }]
    };
}

/** Universal Data Input node (ComfyUI-CloudClient) with its data_uri widget. */
function makeUniversalDataInputNode(value: string): Record<string, unknown> {
    return {
        id: 7,
        type: 'UniversalDataToImage',
        pos: [0, 0],
        size: [200, 100],
        flags: {},
        order: 0,
        mode: 0,
        properties: {},
        inputs: [],
        outputs: [{ name: 'image', type: 'IMAGE', links: [1], slot_index: 0 }],
        widgets_values: [value]
    };
}

/** The widget keys the editor pipeline computes for a raw workflow. */
function editorKeys(raw: Record<string, unknown>) {
    const nodes = renumberNodes(sortNodesDeep(parseWorkflowJson(raw)));
    const all = collectPromptWidgets(nodes);
    return { nodes, all };
}

/** Key of the feeder's first widget (index 0), resolved like the editor does. */
function firstWidgetKey(raw: Record<string, unknown>): string {
    const { all } = editorKeys(raw);
    for (const [key, ref] of all) {
        if (ref.node.classType !== 'PreviewImage' && ref.widget.index === 0) return key;
    }
    throw new Error('feeder widget not found');
}

describe('input-fields', () => {
    // ── 1. extra.inputFields persistence ────────────────────────────────

    it('round-trips Input markings through raw.extra.inputFields', () => {
        const raw = makeWorkflow(makeUniversalDataInputNode(''));
        const key = firstWidgetKey(raw);

        const written = writeInputFieldsToRaw(raw, new Set([key]));
        expect((written.extra as Record<string, unknown>).inputFields).toEqual([key]);

        const { nodes } = editorKeys(raw);
        expect(readSavedInputFields(written, nodes)).toEqual(new Set([key]));
    });

    it('removes extra.inputFields entirely when the set is empty', () => {
        const raw = writeInputFieldsToRaw(makeWorkflow(makeUniversalDataInputNode('')), new Set());
        expect(raw.extra).toBeUndefined();
    });

    it('drops saved keys that no longer resolve against the tree', () => {
        const raw = makeWorkflow(makeUniversalDataInputNode(''));
        const { nodes } = editorKeys(raw);
        const written = writeInputFieldsToRaw(raw, new Set(['nope:data_uri', '999:ghost']));
        expect(readSavedInputFields(written, nodes).size).toBe(0);
    });

    // ── 2. Feeding data into marked Inputs ──────────────────────────────

    it('writes the base64 data URI into the marked data_uri widget', () => {
        const raw = makeWorkflow(makeUniversalDataInputNode(''));
        raw.extra = { inputFields: [firstWidgetKey(raw)] };

        const injected = buildWorkflowWithInputs(raw, DATA_URI);
        expect(injected).not.toBeNull();

        const feederRaw = (injected!.nodes as Record<string, unknown>[]).find(
            (n) => n.type === 'UniversalDataToImage'
        )!;
        expect((feederRaw.widgets_values as unknown[])[0]).toBe(DATA_URI);

        // The original document is never mutated.
        const originalFeeder = (raw.nodes as Record<string, unknown>[])[0];
        expect((originalFeeder.widgets_values as unknown[])[0]).toBe('');
    });

    it('injects marked string widgets but skips marked non-string widgets', () => {
        // Unregistered feeder with a string and a number widget (names
        // inferred from the converted-to-input slots).
        const feeder: Record<string, unknown> = {
            id: 5,
            type: 'UnregisteredStringSource',
            pos: [0, 0],
            size: [200, 100],
            flags: {},
            order: 0,
            mode: 0,
            properties: {},
            inputs: [
                { name: 'text', type: 'STRING', widget: { name: 'text' }, link: null },
                { name: 'count', type: 'INT', widget: { name: 'count' }, link: null }
            ],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1], slot_index: 0 }],
            widgets_values: ['original', 42]
        };
        const raw = makeWorkflow(feeder);

        // Mark BOTH widgets as Inputs.
        const { all } = editorKeys(raw);
        const keys: string[] = [];
        for (const [key, ref] of all) {
            if (ref.node.classType === 'UnregisteredStringSource') keys.push(key);
        }
        expect(keys).toHaveLength(2);
        raw.extra = { inputFields: keys };

        const injected = buildWorkflowWithInputs(raw, DATA_URI)!;
        const feederRaw = (injected.nodes as Record<string, unknown>[]).find(
            (n) => n.type === 'UnregisteredStringSource'
        )!;
        // String widget fed; numeric widget keeps its valid value.
        expect((feederRaw.widgets_values as unknown[])[0]).toBe(DATA_URI);
        expect((feederRaw.widgets_values as unknown[])[1]).toBe(42);
    });

    // ── 3. No-Input workflows ───────────────────────────────────────────

    it('returns null when the workflow declares no Input markings', () => {
        const raw = makeWorkflow(makeUniversalDataInputNode(''));
        expect(buildWorkflowWithInputs(raw, DATA_URI)).toBeNull();
    });

    it('returns null when the only marked widgets are non-string', () => {
        const feeder: Record<string, unknown> = {
            id: 5,
            type: 'UnregisteredNumberSource',
            pos: [0, 0],
            size: [200, 100],
            flags: {},
            order: 0,
            mode: 0,
            properties: {},
            inputs: [{ name: 'count', type: 'INT', widget: { name: 'count' }, link: null }],
            outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1], slot_index: 0 }],
            widgets_values: [42]
        };
        const raw = makeWorkflow(feeder);
        raw.extra = { inputFields: [firstWidgetKey(raw)] };
        expect(buildWorkflowWithInputs(raw, DATA_URI)).toBeNull();
    });
});
