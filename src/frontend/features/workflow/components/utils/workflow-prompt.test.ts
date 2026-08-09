import { describe, expect, it } from 'vitest';
import type { UINode } from '../../../../nodes/node-type';
import { uiNodesToApiPrompt } from './workflow-prompt';

// The server validates every required INPUT_TYPES entry, including controls
// that use an empty default. This regression fixture models the serialized
// widget order for the scheduled Sol attention node and protects the final
// dense_blocks input from being dropped by the static registry mapping.
describe('uiNodesToApiPrompt MiniMax H3 Sol attention inputs', () => {
    it('emits the required dense_blocks input with its empty default', () => {
        const node: UINode = {
            id: '6-12',
            classType: 'MiniMaxH3ScheduledSolAttentionPatch',
            connections: [],
            outputs: [],
            widgets: [
                { index: 0, value: true },
                { index: 1, value: 2 },
                { index: 2, value: 0.8 },
                { index: 3, value: 'linear' },
                { index: 4, value: 8192 },
                { index: 5, value: false },
                { index: 6, value: 0 },
                { index: 7, value: 'diag' },
                { index: 8, value: false },
                { index: 9, value: 'exact_kv' },
                { index: 10, value: '' },
            ],
            mode: 0,
            order: 0,
            properties: {},
            flags: {},
            position: [0, 0],
            size: [200, 100],
            _sourceFormat: 'workflow-v04',
        };

        // Assert the complete API node so the test catches both positional
        // shifts and omission of the required empty-string field.
        expect(uiNodesToApiPrompt([node])).toEqual({
            '6-12': {
                class_type: 'MiniMaxH3ScheduledSolAttentionPatch',
                inputs: {
                    enabled: true,
                    tau_start: 2,
                    tau_end: 0.8,
                    curve: 'linear',
                    min_tokens: 8192,
                    strict: false,
                    dense_percent: 0,
                    thresh_type: 'diag',
                    int8_qk: false,
                    int8_pv: false,
                    sink_conditioning: 'exact_kv',
                    dense_blocks: '',
                },
            },
        });
    });

    // Current ComfyUI serializes int8_pv before sink_conditioning. Assert the
    // complete prompt so a future positional change cannot silently swap values.
    it('emits the current int8_pv slot in source order', () => {
        const node: UINode = {
            id: '7-12',
            classType: 'MiniMaxH3ScheduledSolAttentionPatch',
            connections: [],
            outputs: [],
            widgets: [
                { index: 0, value: true },
                { index: 1, value: 1.3 },
                { index: 2, value: 0.8 },
                { index: 3, value: 'cosine' },
                { index: 4, value: 4096 },
                { index: 5, value: true },
                { index: 6, value: 0.2 },
                { index: 7, value: 'exact' },
                { index: 8, value: true },
                { index: 9, value: true },
                { index: 10, value: 'exact_kv_and_rows' },
                { index: 11, value: '0-2,-1' },
            ],
            mode: 0,
            order: 0,
            properties: {},
            flags: {},
            position: [0, 0],
            size: [200, 100],
            _sourceFormat: 'workflow-v04',
        };

        expect(uiNodesToApiPrompt([node])).toEqual({
            '7-12': {
                class_type: 'MiniMaxH3ScheduledSolAttentionPatch',
                inputs: {
                    enabled: true,
                    tau_start: 1.3,
                    tau_end: 0.8,
                    curve: 'cosine',
                    min_tokens: 4096,
                    strict: true,
                    dense_percent: 0.2,
                    thresh_type: 'exact',
                    int8_qk: true,
                    int8_pv: true,
                    sink_conditioning: 'exact_kv_and_rows',
                    dense_blocks: '0-2,-1',
                },
            },
        });
    });
});

// PathchSageAttentionKJ previously had an empty static layout, so its required
// sage_attention combo was omitted from the generated API prompt. The default
// keeps an unusually old workflow executable while current widgets pass through.
describe('uiNodesToApiPrompt KJNodes Sage attention compatibility', () => {
    it('emits the Sage mode and optional compile flag', () => {
        const node: UINode = {
            id: '7-10',
            classType: 'PathchSageAttentionKJ',
            connections: [],
            outputs: [],
            widgets: [
                { index: 0, value: 'auto' },
                { index: 1, value: true },
            ],
            mode: 0,
            order: 0,
            properties: {},
            flags: {},
            position: [0, 0],
            size: [200, 100],
            _sourceFormat: 'workflow-v04',
        };

        expect(uiNodesToApiPrompt([node])).toEqual({
            '7-10': {
                class_type: 'PathchSageAttentionKJ',
                inputs: {
                    sage_attention: 'auto',
                    allow_compile: true,
                },
            },
        });
    });

    it('backfills disabled Sage mode when a legacy node has no widgets', () => {
        const node: UINode = {
            id: '7-10',
            classType: 'PathchSageAttentionKJ',
            connections: [],
            outputs: [],
            widgets: [],
            mode: 0,
            order: 0,
            properties: {},
            flags: {},
            position: [0, 0],
            size: [200, 100],
            _sourceFormat: 'workflow-v04',
        };

        expect(uiNodesToApiPrompt([node])).toEqual({
            '7-10': {
                class_type: 'PathchSageAttentionKJ',
                inputs: {
                    sage_attention: 'disabled',
                },
            },
        });
    });
});

// MiniMaxH3TurboLoRA gained a required `low_vram` input after older workflows
// were serialized with only `lora_name` and `strength`; the prompt compiler must
// provide the backend's false default without changing those saved widget slots.
describe('uiNodesToApiPrompt MiniMax H3 Turbo LoRA compatibility', () => {
    it('backfills low_vram for a legacy two-widget workflow', () => {
        const node: UINode = {
            id: '8',
            classType: 'MiniMaxH3TurboLoRA',
            connections: [],
            outputs: [],
            widgets: [
                { index: 0, value: 'minimax_h3_turbo.safetensors' },
                { index: 1, value: 1 },
            ],
            mode: 0,
            order: 0,
            properties: {},
            flags: {},
            position: [0, 0],
            size: [200, 100],
            _sourceFormat: 'workflow-v04',
        };

        expect(uiNodesToApiPrompt([node])).toEqual({
            '8': {
                class_type: 'MiniMaxH3TurboLoRA',
                inputs: {
                    lora_name: 'minimax_h3_turbo.safetensors',
                    strength: 1,
                    low_vram: false,
                },
            },
        });
    });

    it('preserves an explicit low_vram widget value', () => {
        const node: UINode = {
            id: '8',
            classType: 'MiniMaxH3TurboLoRA',
            connections: [],
            outputs: [],
            widgets: [
                { index: 0, value: 'minimax_h3_turbo.safetensors' },
                { index: 1, value: 1 },
                { index: 2, value: true },
            ],
            mode: 0,
            order: 0,
            properties: {},
            flags: {},
            position: [0, 0],
            size: [200, 100],
            _sourceFormat: 'workflow-v04',
        };

        expect(uiNodesToApiPrompt([node])).toEqual({
            '8': {
                class_type: 'MiniMaxH3TurboLoRA',
                inputs: {
                    lora_name: 'minimax_h3_turbo.safetensors',
                    strength: 1,
                    low_vram: true,
                },
            },
        });
    });
});
