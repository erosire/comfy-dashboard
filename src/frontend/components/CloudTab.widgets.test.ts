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
//   4. Provides a best-effort fallback for truly unregistered nodes by
//      inferring widget names from the workflow's converted-to-input
//      slots (the `widget.name` field).
// =============================================================================

import { describe, it, expect } from 'vitest';
import { workflowToApiPrompt } from './CloudTab';

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
