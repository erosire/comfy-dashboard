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
                    sink_conditioning: 'exact_kv',
                    dense_blocks: '',
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
