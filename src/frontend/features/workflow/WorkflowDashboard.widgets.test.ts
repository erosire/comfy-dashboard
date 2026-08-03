// =============================================================================
// Widget preservation & priority tests
//
// Verifies that workflowToApiPrompt():
//   1. Includes widget values for nodes that were previously dropped
//      because they were not in the static registry (PrimitiveBoolean,
//      TextBox1, StringConcatenate delimiter, TextGenerate max_length,
//      LoraLoaderModelOnly, etc.).
//   2. Lets connected converted-widget inputs override the stale widget
//      value (connections are emitted AFTER widgets, not before).
//   3. Falls back to the widget value when a converted-widget connection
//      was removed (e.g. an unconnected subgraph input port whose -10
//      sentinel was filtered out during flattening).
//   4. Resolves versioned Preferences values in every compiled JSON string and
//      replaces missing variables with an empty string.
//   5. Provides a best-effort fallback for truly unregistered nodes by
//      inferring widget names from the workflow's converted-to-input
//      slots (the `widget.name` field).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseWorkflowJson, replacePreferenceVariables, workflowToApiPrompt } from './components/utils';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal v1 workflow raw object from nodes & links arrays. */
function makeWorkflow(
    nodes: Record<string, unknown>[],
    links: Record<string, unknown>[]
): Record<string, unknown> {
    return {
        version: 1,
        nodes,
        links,
    };
}

/**
 * A minimal connected sink: PreviewImage with an `images` input slot.
 * The test attaches the node-under-test as the feeder (link 1 → PreviewImage)
 * so sortNodes keeps the feeder (it has an outgoing link) and PreviewImage
 * (it is an output node with an incoming link).
 *
 * Returns the sink node and the link id to use for the feeder → sink edge.
 */
const SINK_NODE_ID = 901;
const SINK_LINK_ID = 1;

function makeSinkNode(): Record<string, unknown> {
    return {
        id: SINK_NODE_ID,
        type: 'PreviewImage',
        pos: [0, 0],
        size: [200, 100],
        flags: {},
        order: 1,
        mode: 0,
        properties: {},
        inputs: [{ name: 'images', type: 'IMAGE', link: SINK_LINK_ID }],
        outputs: [],
    };
}

function makeSinkLink(sourceId: number, sourceSlot: number, type: string): Record<string, unknown> {
    return {
        id: SINK_LINK_ID,
        origin_id: sourceId,
        origin_slot: sourceSlot,
        target_id: SINK_NODE_ID,
        target_slot: 0,
        type,
    };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('frontend preference variable preparation', () => {
    it('replaces repeated, embedded, complete, and missing preference tokens', () => {
        // API prompt input avoids parser concerns and exercises the exact
        // send-time JSON shape that the cloud endpoint forwards to ComfyUI.
        const raw = {
            '1': {
                class_type: 'TextBox',
                inputs: {
                    embedded: 'Hello {{name}} — {{name}}.',
                    completeNumber: '{{count}}',
                    completeBoolean: '{{enabled}}',
                    missing: 'before{{missing}}after',
                    array: ['{{name}}', '{{unknown}}']
                }
            }
        };

        const prepared = replacePreferenceVariables(raw, {
            name: { current: 'Ada' },
            count: { current: 3 },
            enabled: { current: true }
        });

        expect(prepared).toEqual({
            '1': {
                class_type: 'TextBox',
                inputs: {
                    embedded: 'Hello Ada — Ada.',
                    completeNumber: 3,
                    completeBoolean: true,
                    missing: 'beforeafter',
                    array: ['Ada', '']
                }
            }
        });
        // The server receives this prepared JSON and only converts its
        // already-resolved workflow/API shape; it does not receive preferences.
        expect(workflowToApiPrompt(prepared)).toEqual(prepared);
    });

    it('resolves nested preference values, object keys, and custom-only versions', () => {
        // Nested references are resolved before insertion, while the cycle is
        // cut to an empty string so the final serialized JSON has no tokens.
        const raw = {
            '1': {
                class_type: 'TextBox',
                inputs: {
                    nested: '{{greeting}}',
                    object: '{{payload}}',
                    '{{key}}': 'value',
                    cycle: '{{cycle}}'
                }
            }
        };

        const compiled = replacePreferenceVariables(raw, {
            greeting: { current: 'Hello {{name}}' },
            name: { current: 'Ada' },
            payload: { current: { enabled: true, count: 2 } },
            key: { current: 'resolved' },
            customOnly: { release: 'fallback' },
            cycle: { current: '{{cycle}}' }
        });

        expect(compiled).toEqual({
            '1': {
                class_type: 'TextBox',
                inputs: {
                    nested: 'Hello Ada',
                    object: { enabled: true, count: 2 },
                    resolved: 'value',
                    cycle: ''
                }
            }
        });
        expect(JSON.stringify(compiled)).not.toContain('{{');
        expect(replacePreferenceVariables({
            '1': { class_type: 'TextBox', inputs: { value: '{{customOnly}}' } }
        }, { customOnly: { release: 'fallback' } })).toEqual({
            '1': { class_type: 'TextBox', inputs: { value: 'fallback' } }
        });
    });

    it('removes unresolved tokens when no preference profile is available', () => {
        // The server uses the empty preference map when the profile is absent
        // or unavailable; this assertion guards the no-unescaped-braces rule.
        const compiled = replacePreferenceVariables({
            '1': { class_type: 'TextBox', inputs: { value: '{{notConfigured}}' } }
        });

        expect(compiled).toEqual({
            '1': { class_type: 'TextBox', inputs: { value: '' } }
        });
        expect(JSON.stringify(compiled)).not.toContain('{{notConfigured}}');
    });
});

describe('workflowToApiPrompt — widget preservation for previously-unregistered nodes', () => {
    it('includes the widget value for a registered PrimitiveBoolean node', () => {
        // PrimitiveBoolean has one widget ("value") with value false.
        // Before the fix, the widget value was dropped because
        // PrimitiveBoolean was unregistered.
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'PrimitiveBoolean',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'BOOLEAN', type: 'BOOLEAN', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [false],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'BOOLEAN')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const booleanNode = Object.values(prompt).find((n) => n.class_type === 'PrimitiveBoolean');
        expect(booleanNode).toBeDefined();
        expect(booleanNode!.inputs.value).toBe(false);
    });

    it('includes the delimiter widget for a registered StringConcatenate node', () => {
        // StringConcatenate has three widgets: string_a, string_b, delimiter.
        // string_a and string_b are converted to inputs; delimiter is a
        // plain widget. Before the fix, delimiter was dropped because
        // StringConcatenate was unregistered.
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'StringConcatenate',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [
                        { name: 'string_a', type: 'STRING', widget: { name: 'string_a' }, link: null },
                        { name: 'string_b', type: 'STRING', widget: { name: 'string_b' }, link: null },
                    ],
                    outputs: [{ name: 'STRING', type: 'STRING', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: ['hello', 'world', ', '],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'STRING')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const concatNode = Object.values(prompt).find((n) => n.class_type === 'StringConcatenate');
        expect(concatNode).toBeDefined();
        expect(concatNode!.inputs.string_a).toBe('hello');
        expect(concatNode!.inputs.string_b).toBe('world');
        expect(concatNode!.inputs.delimiter).toBe(', ');
    });

    it('includes text1 widget for a TextBox1 node (no inputs, one widget)', () => {
        // TextBox1 has no inputs array and one widget "text1". Before the
        // fix, the widget value was dropped because TextBox1 was
        // unregistered and had no converted-to-input slots to infer from.
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'TextBox1',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'text1', type: 'STRING', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: ['my text'],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'STRING')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const textBoxNode = Object.values(prompt).find((n) => n.class_type === 'TextBox1');
        expect(textBoxNode).toBeDefined();
        expect(textBoxNode!.inputs.text1).toBe('my text');
    });
});

describe('workflowToApiPrompt — widget/connection priority', () => {
    it('connection overrides the stale widget value for a converted widget', () => {
        // KSampler's seed widget is converted to an input and connected to
        // a Seed (rgthree) node. The widget value (stale) must NOT
        // overwrite the link reference — connections are emitted AFTER
        // widgets so they win.
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'Seed (rgthree)',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'SEED', type: 'INT', links: [10], slot_index: 0 }],
                    widgets_values: [12345, 'fixed'],
                },
                {
                    id: 2,
                    type: 'KSampler',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 1,
                    mode: 0,
                    properties: {},
                    inputs: [
                        { name: 'model', type: 'MODEL', link: null },
                        { name: 'positive', type: 'CONDITIONING', link: null },
                        { name: 'negative', type: 'CONDITIONING', link: null },
                        { name: 'latent_image', type: 'LATENT', link: 30 },
                        { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: 10 },
                    ],
                    outputs: [{ name: 'LATENT', type: 'LATENT', links: [20], slot_index: 0 }],
                    widgets_values: [99999, 'randomize', 8, 1, 'euler', 'normal', 1],
                },
                {
                    id: 3,
                    type: 'EmptyLatentImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 2,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'LATENT', type: 'LATENT', links: [30], slot_index: 0 }],
                    widgets_values: [512, 512, 1],
                },
                {
                    id: 4,
                    type: 'PreviewImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 3,
                    mode: 0,
                    properties: {},
                    inputs: [{ name: 'images', type: 'IMAGE', link: 40 }],
                    outputs: [],
                },
                {
                    id: 5,
                    type: 'EmptyLatentImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 4,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'LATENT', type: 'LATENT', links: [40], slot_index: 0 }],
                    widgets_values: [512, 512, 1],
                },
            ],
            [
                { id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 4, type: 'INT' },
                { id: 30, origin_id: 3, origin_slot: 0, target_id: 2, target_slot: 3, type: 'LATENT' },
                { id: 40, origin_id: 5, origin_slot: 0, target_id: 4, target_slot: 0, type: 'LATENT' },
                { id: 20, origin_id: 2, origin_slot: 0, target_id: 4, target_slot: 0, type: 'LATENT' },
            ]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const ksampler = Object.values(prompt).find((n) => n.class_type === 'KSampler');
        expect(ksampler).toBeDefined();
        // seed must be the link reference to the Seed node, NOT the stale
        // widget value 99999.
        const seedInput = ksampler!.inputs.seed;
        expect(Array.isArray(seedInput)).toBe(true);
        expect(seedInput).not.toBe(99999);
    });

    it('falls back to widget value when a converted-widget connection is absent', () => {
        // KSampler's seed widget is converted to an input but NOT connected
        // (link: null). The widget value must be used as the seed input.
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'KSampler',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [
                        { name: 'model', type: 'MODEL', link: null },
                        { name: 'positive', type: 'CONDITIONING', link: null },
                        { name: 'negative', type: 'CONDITIONING', link: null },
                        { name: 'latent_image', type: 'LATENT', link: 2 },
                        { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: null },
                    ],
                    outputs: [{ name: 'LATENT', type: 'LATENT', links: [1], slot_index: 0 }],
                    widgets_values: [42, 'fixed', 8, 1, 'euler', 'normal', 1],
                },
                {
                    id: 2,
                    type: 'EmptyLatentImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 1,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'LATENT', type: 'LATENT', links: [2], slot_index: 0 }],
                    widgets_values: [512, 512, 1],
                },
                {
                    id: 3,
                    type: 'PreviewImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 2,
                    mode: 0,
                    properties: {},
                    inputs: [{ name: 'images', type: 'IMAGE', link: 3 }],
                    outputs: [],
                },
                {
                    id: 4,
                    type: 'EmptyLatentImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 3,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'LATENT', type: 'LATENT', links: [3], slot_index: 0 }],
                    widgets_values: [512, 512, 1],
                },
            ],
            [
                { id: 2, origin_id: 2, origin_slot: 0, target_id: 1, target_slot: 3, type: 'LATENT' },
                { id: 3, origin_id: 4, origin_slot: 0, target_id: 3, target_slot: 0, type: 'LATENT' },
                { id: 1, origin_id: 1, origin_slot: 0, target_id: 3, target_slot: 0, type: 'LATENT' },
            ]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const ksampler = Object.values(prompt).find((n) => n.class_type === 'KSampler');
        expect(ksampler).toBeDefined();
        // seed has no connection — widget value 42 must be used.
        expect(ksampler!.inputs.seed).toBe(42);
    });
});

describe('workflowToApiPrompt — subgraph flattening with unconnected ports', () => {
    // A subgraph that exposes a PrimitiveBoolean's "value" widget as an
    // input port. The parent does NOT wire that port. After flattening,
    // the -10 sentinel connection is removed and the widget value must
    // fall back to the PrimitiveBoolean's own widget value (false).
    const subgraphId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    function makeSubgraphWorkflow(): Record<string, unknown> {
        return {
            version: 1,
            nodes: [
                {
                    id: 1,
                    type: subgraphId,
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    // value_2 (enable_lora?) port is NOT connected (link: null)
                    inputs: [
                        { name: 'value_2', type: 'BOOLEAN', link: null },
                    ],
                    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [2], slot_index: 0 }],
                    widgets_values: [],
                },
                {
                    id: 2,
                    type: 'PreviewImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 1,
                    mode: 0,
                    properties: {},
                    inputs: [{ name: 'images', type: 'IMAGE', link: 2 }],
                    outputs: [],
                },
            ],
            links: [
                { id: 2, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'IMAGE' },
            ],
            definitions: {
                subgraphs: [
                    {
                        id: subgraphId,
                        version: 1,
                        name: 'Test Subgraph',
                        inputNode: { id: -10, bounding: [0, 0, 100, 50] },
                        outputNode: { id: -20, bounding: [0, 0, 100, 50] },
                        inputs: [
                            { id: 'p1', name: 'value_2', type: 'BOOLEAN', linkIds: [10] },
                        ],
                        outputs: [
                            { id: 'o1', name: 'IMAGE', type: 'IMAGE', linkIds: [11] },
                        ],
                        nodes: [
                            {
                                id: 101,
                                type: 'PrimitiveBoolean',
                                pos: [0, 0],
                                size: [200, 100],
                                flags: {},
                                order: 0,
                                mode: 0,
                                properties: {},
                                inputs: [
                                    { name: 'value', type: 'BOOLEAN', widget: { name: 'value' }, link: 10 },
                                ],
                                outputs: [{ name: 'BOOLEAN', type: 'BOOLEAN', links: [14], slot_index: 0 }],
                                widgets_values: [false],
                            },
                            {
                                id: 102,
                                type: 'EmptyLatentImage',
                                pos: [0, 0],
                                size: [200, 100],
                                flags: {},
                                order: 1,
                                mode: 0,
                                properties: {},
                                inputs: [],
                                outputs: [{ name: 'LATENT', type: 'LATENT', links: [12], slot_index: 0 }],
                                widgets_values: [512, 512, 1],
                            },
                            {
                                id: 103,
                                type: 'VAEDecode',
                                pos: [0, 0],
                                size: [200, 100],
                                flags: {},
                                order: 2,
                                mode: 0,
                                properties: {},
                                inputs: [
                                    { name: 'samples', type: 'LATENT', link: 12 },
                                    { name: 'vae', type: 'VAE', link: 13 },
                                    { name: 'switch', type: 'BOOLEAN', link: 14 },
                                ],
                                outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [11], slot_index: 0 }],
                                widgets_values: [],
                            },
                            {
                                id: 104,
                                type: 'VAELoader',
                                pos: [0, 0],
                                size: [200, 100],
                                flags: {},
                                order: 3,
                                mode: 0,
                                properties: {},
                                inputs: [],
                                outputs: [{ name: 'VAE', type: 'VAE', links: [13], slot_index: 0 }],
                                widgets_values: ['vae.safetensors'],
                            },
                        ],
                        links: [
                            { id: 10, origin_id: -10, origin_slot: 0, target_id: 101, target_slot: 0, type: 'BOOLEAN' },
                            { id: 11, origin_id: 103, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
                            { id: 12, origin_id: 102, origin_slot: 0, target_id: 103, target_slot: 0, type: 'LATENT' },
                            { id: 13, origin_id: 104, origin_slot: 0, target_id: 103, target_slot: 1, type: 'VAE' },
                            { id: 14, origin_id: 101, origin_slot: 0, target_id: 103, target_slot: 2, type: 'BOOLEAN' },
                        ],
                    },
                ],
            },
        };
    }

    it('falls back to the PrimitiveBoolean widget value when the subgraph port is unconnected', () => {
        const prompt = workflowToApiPrompt(makeSubgraphWorkflow()) as Record<string, {
            class_type: string;
            inputs: Record<string, unknown>;
        }>;

        const booleanNode = Object.values(prompt).find((n) => n.class_type === 'PrimitiveBoolean');
        expect(booleanNode).toBeDefined();
        // The -10 sentinel link was removed (parent port unconnected) —
        // the widget value `false` must be used as the `value` input.
        expect(booleanNode!.inputs.value).toBe(false);
    });
});

describe('workflowToApiPrompt — fallback for truly unregistered nodes', () => {
    it('infers widget names from converted-to-input slots', () => {
        // A completely unknown node type with a converted widget "value"
        // that is NOT connected. The fallback should infer the name from
        // the input's `widget.name` and include the widget value.
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'TotallyUnknownNode',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [
                        { name: 'value', type: 'BOOLEAN', widget: { name: 'value' }, link: null },
                    ],
                    outputs: [{ name: 'BOOLEAN', type: 'BOOLEAN', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [true],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'BOOLEAN')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const unknownNode = Object.values(prompt).find((n) => n.class_type === 'TotallyUnknownNode');
        expect(unknownNode).toBeDefined();
        // The fallback infers "value" from the converted-to-input slot
        // and includes the widget value true.
        expect(unknownNode!.inputs.value).toBe(true);
    });
});

describe('workflowToApiPrompt — DynamicCombo sub-widget names are prefixed', () => {
    it('emits sampling_mode sub-widgets with sampling_mode.* prefix', () => {
        // TextGenerate uses a DynamicCombo ("sampling_mode"). Its sub-widgets
        // (temperature, top_k, etc.) are flattened into widgets_values but
        // must be emitted in the API prompt with the prefix
        // "sampling_mode." — the ComfyUI frontend creates each sub-widget
        // with the name `${comboName}.${subKey}` (dynamicWidgets.ts).
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'TextGenerate',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [
                        { name: 'clip', type: 'CLIP', link: null },
                        { name: 'prompt', type: 'STRING', widget: { name: 'prompt' }, link: null },
                        { name: 'max_length', type: 'INT', widget: { name: 'max_length' }, link: null },
                    ],
                    outputs: [{ name: 'STRING', type: 'STRING', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [
                        '',     // prompt
                        512,    // max_length
                        'on',   // sampling_mode
                        0.7,    // temperature
                        64,     // top_k
                        0.95,   // top_p
                        0.05,   // min_p
                        1.05,   // repetition_penalty
                        0,      // seed
                        0,      // presence_penalty
                        false,  // thinking
                        true,   // use_default_template
                    ],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'STRING')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const textGen = Object.values(prompt).find((n) => n.class_type === 'TextGenerate');
        expect(textGen).toBeDefined();
        // Sub-widget values must be emitted with the "sampling_mode." prefix
        expect(textGen!.inputs['sampling_mode']).toBe('on');
        expect(textGen!.inputs['sampling_mode.temperature']).toBe(0.7);
        expect(textGen!.inputs['sampling_mode.top_k']).toBe(64);
        expect(textGen!.inputs['sampling_mode.top_p']).toBe(0.95);
        expect(textGen!.inputs['sampling_mode.min_p']).toBe(0.05);
        expect(textGen!.inputs['sampling_mode.repetition_penalty']).toBe(1.05);
        expect(textGen!.inputs['sampling_mode.seed']).toBe(0);
        expect(textGen!.inputs['sampling_mode.presence_penalty']).toBe(0);
        // Non-DynamicCombo widgets use their plain names
        expect(textGen!.inputs['thinking']).toBe(false);
        expect(textGen!.inputs['use_default_template']).toBe(true);
    });
});

describe('workflowToApiPrompt — disabled/bypassed nodes are excluded', () => {
    it('excludes a bypassed (mode 4) node from the prompt entirely', () => {
        // The API prompt has no mode concept — anything in it is executed
        // by the server. A bypassed node must therefore never be emitted
        // (mirrors ComfyUI's own frontend).
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'PrimitiveBoolean',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 4, // BYPASS
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'BOOLEAN', type: 'BOOLEAN', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [false],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'BOOLEAN')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        expect(Object.values(prompt).find((n) => n.class_type === 'PrimitiveBoolean')).toBeUndefined();
        // The sink survives, and its link to the excluded node is dropped
        // rather than left dangling.
        const sink = Object.values(prompt).find((n) => n.class_type === 'PreviewImage');
        expect(sink).toBeDefined();
        expect(sink!.inputs.images).toBeUndefined();
    });

    it('excludes a disabled (mode 2) node from the prompt entirely', () => {
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'PrimitiveBoolean',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 2, // NEVER / muted
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'BOOLEAN', type: 'BOOLEAN', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [true],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'BOOLEAN')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        expect(Object.values(prompt).find((n) => n.class_type === 'PrimitiveBoolean')).toBeUndefined();
        const sink = Object.values(prompt).find((n) => n.class_type === 'PreviewImage');
        expect(sink).toBeDefined();
        expect(sink!.inputs.images).toBeUndefined();
    });

    it('excludes the bypassed optional-image node from the krea2-style workflow', () => {
        // Regression test for the reported failure: a bypassed
        // UniversalDataToImage whose data_uri widget is empty was submitted
        // to the pod and crashed on `Image.open(b"")`. The node (and the
        // links pointing at it) must simply not be in the prompt.
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'UniversalDataToImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 4, // bypassed optional second reference
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [11], slot_index: 0 }],
                    widgets_values: [''],
                },
                {
                    id: 2,
                    type: 'VAEEncode',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 1,
                    mode: 0,
                    properties: {},
                    inputs: [
                        { name: 'pixels', type: 'IMAGE', link: 11 },
                        { name: 'vae', type: 'VAE', link: null },
                    ],
                    outputs: [{ name: 'LATENT', type: 'LATENT', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [],
                },
                makeSinkNode(),
            ],
            [
                { id: 11, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'IMAGE' },
                makeSinkLink(2, 0, 'LATENT'),
            ]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        expect(Object.values(prompt).find((n) => n.class_type === 'UniversalDataToImage')).toBeUndefined();
        const vaeEncode = Object.values(prompt).find((n) => n.class_type === 'VAEEncode');
        expect(vaeEncode).toBeDefined();
        // No dangling [nodeId, slot] reference to the excluded node.
        expect(vaeEncode!.inputs.pixels).toBeUndefined();
    });

    it('falls back to the widget value when a converted-widget link source is bypassed', () => {
        // KSampler's seed widget is converted to an input and connected to a
        // BYPASSED Seed node. ComfyUI severs the link and uses the widget
        // value — so must we (the link ref is dropped, the widget emission
        // from the first pass survives).
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'Seed (rgthree)',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 4, // BYPASS
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'SEED', type: 'INT', links: [10], slot_index: 0 }],
                    widgets_values: [12345, 'fixed'],
                },
                {
                    id: 2,
                    type: 'KSampler',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 1,
                    mode: 0,
                    properties: {},
                    inputs: [
                        { name: 'model', type: 'MODEL', link: null },
                        { name: 'positive', type: 'CONDITIONING', link: null },
                        { name: 'negative', type: 'CONDITIONING', link: null },
                        { name: 'latent_image', type: 'LATENT', link: 30 },
                        { name: 'seed', type: 'INT', widget: { name: 'seed' }, link: 10 },
                    ],
                    outputs: [{ name: 'LATENT', type: 'LATENT', links: [20], slot_index: 0 }],
                    widgets_values: [99999, 'randomize', 8, 1, 'euler', 'normal', 1],
                },
                {
                    id: 3,
                    type: 'EmptyLatentImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 2,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'LATENT', type: 'LATENT', links: [30], slot_index: 0 }],
                    widgets_values: [512, 512, 1],
                },
                {
                    id: 4,
                    type: 'PreviewImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 3,
                    mode: 0,
                    properties: {},
                    inputs: [{ name: 'images', type: 'IMAGE', link: 20 }],
                    outputs: [],
                },
            ],
            [
                { id: 10, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 4, type: 'INT' },
                { id: 30, origin_id: 3, origin_slot: 0, target_id: 2, target_slot: 3, type: 'LATENT' },
                { id: 20, origin_id: 2, origin_slot: 0, target_id: 4, target_slot: 0, type: 'LATENT' },
            ]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        expect(Object.values(prompt).find((n) => n.class_type === 'Seed (rgthree)')).toBeUndefined();
        const ksampler = Object.values(prompt).find((n) => n.class_type === 'KSampler');
        expect(ksampler).toBeDefined();
        // seed must be the widget value — NOT a [nodeId, slot] link to the
        // excluded bypassed node.
        const seedInput = ksampler!.inputs.seed;
        expect(Array.isArray(seedInput)).toBe(false);
        expect(seedInput).toBe(99999);
        // Unrelated active links are untouched.
        expect(ksampler!.inputs.latent_image).toEqual([expect.any(String), 0]);
    });
});

describe('parseWorkflowJson — node titles', () => {
    it('carries the workflow node title onto the UINode', () => {
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'UniversalDataToImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    title: 'Source Image',
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: ['https://example.com/x.png'],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'IMAGE')]
        );

        const nodes = parseWorkflowJson(raw);
        const source = nodes.find((n) => n.classType === 'UniversalDataToImage');
        expect(source).toBeDefined();
        expect(source!.title).toBe('Source Image');
    });

    it('leaves title undefined when the workflow node has none', () => {
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'PrimitiveBoolean',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'BOOLEAN', type: 'BOOLEAN', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [false],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'BOOLEAN')]
        );

        const nodes = parseWorkflowJson(raw);
        const boolNode = nodes.find((n) => n.classType === 'PrimitiveBoolean');
        expect(boolNode).toBeDefined();
        expect(boolNode!.title).toBeUndefined();
    });

    it('reads the title from _meta.title in API prompt format', () => {
        const raw = {
            '1': {
                class_type: 'UniversalDataToImage',
                inputs: { data_uri: 'data:image/png;base64,AAAA' },
                _meta: { title: 'negative (leave empty)' },
            },
            '2': { class_type: 'PreviewImage', inputs: { images: ['1', 0] } },
        } as unknown as Record<string, unknown>;

        const nodes = parseWorkflowJson(raw);
        const source = nodes.find((n) => n.classType === 'UniversalDataToImage');
        expect(source!.title).toBe('negative (leave empty)');
        const sink = nodes.find((n) => n.classType === 'PreviewImage');
        expect(sink!.title).toBeUndefined();
    });
});

describe('workflowToApiPrompt — nested subgraph whose internals only feed outputs', () => {
    // Regression: the execution sort used to discard internal nodes whose
    // only links go to the -20 output sentinel (loader-bank subgraphs like
    // a "Models" group: loaders with no inputs and no internal consumers).
    // With every internal node gone, the wrapper could no longer be
    // dissolved and leaked into the API prompt as
    // { class_type: '<subgraph name>' } — which ComfyUI rejects with
    // "Node '<name>' not found".
    const outerSubgraphId = '11111111-2222-3333-4444-555555555555';
    const innerSubgraphId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    function makeNestedWorkflow(): Record<string, unknown> {
        return {
            version: 1,
            nodes: [
                {
                    id: 1,
                    type: outerSubgraphId,
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [],
                },
                makeSinkNode(),
            ],
            links: [makeSinkLink(1, 0, 'IMAGE')],
            definitions: {
                subgraphs: [
                    {
                        id: outerSubgraphId,
                        version: 1,
                        name: 'Outer',
                        inputNode: { id: -10, bounding: [0, 0, 100, 50] },
                        outputNode: { id: -20, bounding: [0, 0, 100, 50] },
                        inputs: [],
                        outputs: [{ id: 'o1', name: 'IMAGE', type: 'IMAGE', linkIds: [103] }],
                        nodes: [
                            {
                                // Nested "loader bank" subgraph (all internals
                                // feed -20 only — dropped by the sort pre-fix).
                                id: 100,
                                type: innerSubgraphId,
                                pos: [0, 0],
                                size: [200, 100],
                                flags: {},
                                order: 0,
                                mode: 0,
                                properties: {},
                                inputs: [],
                                outputs: [{ name: 'VAE', type: 'VAE', links: [102], slot_index: 0 }],
                                widgets_values: [],
                            },
                            {
                                id: 101,
                                type: 'EmptyLatentImage',
                                pos: [0, 0],
                                size: [200, 100],
                                flags: {},
                                order: 1,
                                mode: 0,
                                properties: {},
                                inputs: [],
                                outputs: [{ name: 'LATENT', type: 'LATENT', links: [101], slot_index: 0 }],
                                widgets_values: [512, 512, 1],
                            },
                            {
                                id: 102,
                                type: 'VAEDecode',
                                pos: [0, 0],
                                size: [200, 100],
                                flags: {},
                                order: 2,
                                mode: 0,
                                properties: {},
                                inputs: [
                                    { name: 'samples', type: 'LATENT', link: 101 },
                                    { name: 'vae', type: 'VAE', link: 102 },
                                ],
                                outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [103], slot_index: 0 }],
                                widgets_values: [],
                            },
                        ],
                        links: [
                            { id: 101, origin_id: 101, origin_slot: 0, target_id: 102, target_slot: 0, type: 'LATENT' },
                            { id: 102, origin_id: 100, origin_slot: 0, target_id: 102, target_slot: 1, type: 'VAE' },
                            { id: 103, origin_id: 102, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' },
                        ],
                    },
                    {
                        id: innerSubgraphId,
                        version: 1,
                        name: 'ModelBank',
                        inputNode: { id: -10, bounding: [0, 0, 100, 50] },
                        outputNode: { id: -20, bounding: [0, 0, 100, 50] },
                        inputs: [],
                        outputs: [{ id: 'o1', name: 'VAE', type: 'VAE', linkIds: [201] }],
                        nodes: [
                            {
                                // Feeds ONLY the -20 output sentinel: no inputs,
                                // no internal consumers — the node the old sort
                                // discarded, emptying the whole subgraph.
                                id: 201,
                                type: 'VAELoader',
                                pos: [0, 0],
                                size: [200, 100],
                                flags: {},
                                order: 0,
                                mode: 0,
                                properties: {},
                                inputs: [],
                                outputs: [{ name: 'VAE', type: 'VAE', links: [201], slot_index: 0 }],
                                widgets_values: ['vae.safetensors'],
                            },
                        ],
                        links: [
                            { id: 201, origin_id: 201, origin_slot: 0, target_id: -20, target_slot: 0, type: 'VAE' },
                        ],
                    },
                ],
            },
        };
    }

    it('keeps loader-bank internals and dissolves the nested wrapper completely', () => {
        const prompt = workflowToApiPrompt(makeNestedWorkflow()) as Record<string, {
            class_type: string;
            inputs: Record<string, unknown>;
        }>;

        const classTypes = Object.values(prompt).map((n) => n.class_type);
        // Neither wrapper may survive as a node in the prompt.
        expect(classTypes).not.toContain('Outer');
        expect(classTypes).not.toContain('ModelBank');

        // The nested loader must be present with its widget value.
        const vaeLoaderEntry = Object.entries(prompt).find(([, n]) => n.class_type === 'VAELoader');
        expect(vaeLoaderEntry).toBeDefined();
        expect(vaeLoaderEntry![1].inputs.vae_name).toBe('vae.safetensors');

        // VAEDecode's vae input must be rewired to that loader.
        const vaeDecode = Object.values(prompt).find((n) => n.class_type === 'VAEDecode');
        expect(vaeDecode).toBeDefined();
        expect(vaeDecode!.inputs.vae).toEqual([vaeLoaderEntry![0], 0]);

        // No dangling link references at all.
        const ids = new Set(Object.keys(prompt));
        for (const [id, node] of Object.entries(prompt)) {
            for (const val of Object.values(node.inputs)) {
                if (Array.isArray(val) && val.length === 2 && typeof val[0] === 'string') {
                    expect(ids.has(val[0]), `node ${id} references missing node '${val[0]}'`).toBe(true);
                }
            }
        }
    });
});

describe('workflowToApiPrompt — LTXVImgToVideoInplaceKJ dynamic-combo widget order', () => {
    // Regression: the registry used to map the per-image widget slots as
    // [num_images, index_i, strength_i], but ComfyUI's frontend serializes
    // them STRENGTH-FIRST: a workflow saved with untouched defaults stores
    // widgets_values ["1", 1, 0], and the matching API prompt reads
    // { num_images: "1", "num_images.strength_1": 1, "num_images.index_1": 0 }.
    // The swapped mapping emitted strength_1=0 — silently disabling the
    // first-frame image conditioning (the generated video ignored the
    // reference image entirely).
    it('maps widgets_values ["1", 1, 0] to strength_1=1, index_1=0 — not the reverse', () => {
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'LTXVImgToVideoInplaceKJ',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [
                        { name: 'vae', type: 'VAE', link: null },
                        { name: 'latent', type: 'LATENT', link: null },
                        { name: 'num_images.image_1', type: 'IMAGE', link: null },
                    ],
                    outputs: [{ name: 'latent', type: 'LATENT', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: ['1', 1, 0],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'LATENT')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const node = Object.values(prompt).find((n) => n.class_type === 'LTXVImgToVideoInplaceKJ');
        expect(node).toBeDefined();
        expect(node!.inputs.num_images).toBe('1');
        expect(node!.inputs['num_images.strength_1']).toBe(1);
        expect(node!.inputs['num_images.index_1']).toBe(0);
    });

    it('keeps per-group strength/index pairing for multi-image selections', () => {
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'LTXVImgToVideoInplaceKJ',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [
                        { name: 'vae', type: 'VAE', link: null },
                        { name: 'latent', type: 'LATENT', link: null },
                        { name: 'num_images.image_1', type: 'IMAGE', link: null },
                        { name: 'num_images.image_2', type: 'IMAGE', link: null },
                    ],
                    outputs: [{ name: 'latent', type: 'LATENT', links: [SINK_LINK_ID], slot_index: 0 }],
                    // num_images=2 → [combo, strength_1, index_1, strength_2, index_2]
                    widgets_values: ['2', 0.5, 20, 0.8, 40],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'LATENT')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const node = Object.values(prompt).find((n) => n.class_type === 'LTXVImgToVideoInplaceKJ');
        expect(node).toBeDefined();
        expect(node!.inputs.num_images).toBe('2');
        expect(node!.inputs['num_images.strength_1']).toBe(0.5);
        expect(node!.inputs['num_images.index_1']).toBe(20);
        expect(node!.inputs['num_images.strength_2']).toBe(0.8);
        expect(node!.inputs['num_images.index_2']).toBe(40);
    });
});

describe('workflowToApiPrompt — VAELoaderKJ widget emission', () => {
    // Regression: VAELoaderKJ was registered with an empty widget list, so
    // NONE of its widget values reached the prompt — the pod rejected it
    // with "Required input is missing: vae_name / weight_dtype / device".
    it('emits vae_name, device and weight_dtype in INPUT_TYPES order', () => {
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'VAELoaderKJ',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'VAE', type: 'VAE', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: ['ltx-2.3-spatial-upscaler-x2-1.0.safetensors', 'cpu', 'bf16'],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'VAE')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const node = Object.values(prompt).find((n) => n.class_type === 'VAELoaderKJ');
        expect(node).toBeDefined();
        expect(node!.inputs.vae_name).toBe('ltx-2.3-spatial-upscaler-x2-1.0.safetensors');
        expect(node!.inputs.device).toBe('cpu');
        expect(node!.inputs.weight_dtype).toBe('bf16');
    });
});

describe('workflowToApiPrompt — PrimitiveInt widget emission', () => {
    it('emits the value widget; the control-mode companion is not an API input', () => {
        // Saved workflows carry a second widgets_values entry for the
        // control mode ("fixed"/"randomize"/…) — it has no API input, so
        // the prompt must only carry `value` (mirrors Seed's behaviour).
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'PrimitiveInt',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [],
                    outputs: [{ name: 'INT', type: 'INT', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [480, 'fixed'],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'INT')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const node = Object.values(prompt).find((n) => n.class_type === 'PrimitiveInt');
        expect(node).toBeDefined();
        expect(node!.inputs.value).toBe(480);
        expect(node!.inputs.control_after_generate).toBeUndefined();
    });
});

describe('workflowToApiPrompt — Power Lora Loader (rgthree) dynamic widgets', () => {
    // The node's lora count is variable, so widget slots shift: a saved
    // workflow with 3 loras stores [divider{}, header{}, lora×3, divider{},
    // button ""]. Regression: the old registry emitted NONE of these
    // (empty widget list), and the editor displayed "[object Object]".
    it('rebuilds header/lora_N/add-lora inputs, skipping dividers, mirroring rgthree', () => {
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'Power Lora Loader (rgthree)',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: { 'Show Strengths': 'Single Strength', Match: '' },
                    inputs: [{ name: 'model', type: 'MODEL', link: null }],
                    outputs: [{ name: 'MODEL', type: 'MODEL', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [
                        {},
                        { type: 'PowerLoraLoaderHeaderWidget' },
                        { on: false, lora: 'LTX23_OmniNFT_RL_bf16.safetensors', strength: 1, strengthTwo: null },
                        { on: false, lora: 'LTX23_DR34ML4Y_v2.safetensors', strength: 0.7, strengthTwo: null },
                        { on: false, lora: 'LTX23_Reasoning_v3.safetensors', strength: 1, strengthTwo: null },
                        {},
                        '',
                    ],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'MODEL')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const node = Object.values(prompt).find((n) => n.class_type === 'Power Lora Loader (rgthree)');
        expect(node).toBeDefined();

        // Matches the structure ComfyUI itself produces for this node.
        expect(node!.inputs.PowerLoraLoaderHeaderWidget).toEqual({ type: 'PowerLoraLoaderHeaderWidget' });
        expect(node!.inputs.lora_1).toEqual({ on: false, lora: 'LTX23_OmniNFT_RL_bf16.safetensors', strength: 1 });
        expect(node!.inputs.lora_2).toEqual({ on: false, lora: 'LTX23_DR34ML4Y_v2.safetensors', strength: 0.7 });
        expect(node!.inputs.lora_3).toEqual({ on: false, lora: 'LTX23_Reasoning_v3.safetensors', strength: 1 });
        expect(node!.inputs['➕ Add Lora']).toBe('');
        // Divider spacers have no API input.
        expect(node!.inputs.divider).toBeUndefined();
    });

    it('keeps strengthTwo when it is a real value (Separate Model & Clip mode)', () => {
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'Power Lora Loader (rgthree)',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: { 'Show Strengths': 'Separate Model & Clip', Match: '' },
                    inputs: [{ name: 'model', type: 'MODEL', link: null }],
                    outputs: [{ name: 'MODEL', type: 'MODEL', links: [SINK_LINK_ID], slot_index: 0 }],
                    widgets_values: [
                        {},
                        { type: 'PowerLoraLoaderHeaderWidget' },
                        { on: true, lora: 'a.safetensors', strength: 0.5, strengthTwo: 0.25 },
                        {},
                        '',
                    ],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'MODEL')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const node = Object.values(prompt).find((n) => n.class_type === 'Power Lora Loader (rgthree)');
        expect(node!.inputs.lora_1).toEqual({ on: true, lora: 'a.safetensors', strength: 0.5, strengthTwo: 0.25 });
    });

    it('counts only lora objects when naming lora_N (slot gaps do not shift names)', () => {
        const raw = makeWorkflow(
            [
                {
                    id: 1,
                    type: 'Power Lora Loader (rgthree)',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    inputs: [{ name: 'model', type: 'MODEL', link: null }],
                    outputs: [{ name: 'MODEL', type: 'MODEL', links: [SINK_LINK_ID], slot_index: 0 }],
                    // A single lora at slot index 2 must still become lora_1.
                    widgets_values: [
                        {},
                        { type: 'PowerLoraLoaderHeaderWidget' },
                        { on: true, lora: 'solo.safetensors', strength: 0.9, strengthTwo: null },
                        {},
                        '',
                    ],
                },
                makeSinkNode(),
            ],
            [makeSinkLink(1, 0, 'MODEL')]
        );

        const prompt = workflowToApiPrompt(raw) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;

        const node = Object.values(prompt).find((n) => n.class_type === 'Power Lora Loader (rgthree)');
        expect(node!.inputs.lora_1).toEqual({ on: true, lora: 'solo.safetensors', strength: 0.9 });
        expect(node!.inputs.lora_2).toBeUndefined();
    });
});
