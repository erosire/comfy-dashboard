import { describe, expect, it } from 'vitest';
import { comfyNodeRegistry, getWidgetLabel, isNodeRegistered } from './index';

// These entries cover the recently encountered built-in, LTXV, EasyCache, and
// MiniMax H3 S&R names; exact layouts protect positional serialization.
describe('comfyNodeRegistry missing node entries', () => {
    it('registers every requested node type', () => {
        expect([
            'BasicGuider',
            'BasicScheduler',
            'ComfyMathExpression',
            'EasyCache',
            'MiniMaxH3ImageToVideo',
            'MiniMaxH3ScheduledSolAttentionPatch',
            'MiniMaxH3SigmaShift',
            'MiniMaxH3TurboLoRA',
            'MiniMaxH3TurboSampler',
            'ResizeImageMaskNode',
            'LTXVImgToVideoInplace',
            'VAEDecodeAudio',
        ].map(isNodeRegistered)).toEqual([
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
            true,
        ]);
    });

    // KJNodes exposes Sage mode as a required widget after the model connection;
    // registering it prevents the dashboard from silently dropping the value.
    it('maps the current KJNodes Sage attention controls', () => {
        expect(comfyNodeRegistry.PathchSageAttentionKJ.widgets).toEqual([
            {
                name: 'sage_attention',
                label: 'Sage Attention',
                widgetType: 'COMBO',
                options: [
                    'disabled',
                    'auto',
                    'sageattn_qk_int8_pv_fp16_cuda',
                    'sageattn_qk_int8_pv_fp16_triton',
                    'sageattn_qk_int8_pv_fp8_cuda',
                    'sageattn_qk_int8_pv_fp8_cuda++',
                    'sageattn3',
                    'sageattn3_per_block_mean',
                ],
                default: 'disabled',
                tooltip: 'Attention implementation used by the patched model.',
            },
            {
                name: 'allow_compile',
                label: 'Allow Compile',
                widgetType: 'BOOLEAN',
                default: false,
                optional: true,
                tooltip: 'Allow torch.compile for Sage attention when supported.',
            },
        ]);
        expect(comfyNodeRegistry.PathchSageAttentionKJ.promptDefaults).toEqual({
            sage_attention: 'disabled',
        });
    });

    it('maps EasyCache scalar widgets after its model connection', () => {
        expect(comfyNodeRegistry.EasyCache.widgets).toEqual([
            {
                name: 'reuse_threshold',
                label: 'Reuse Threshold',
                widgetType: 'FLOAT',
                default: 0.2,
                min: 0,
                max: 3,
                step: 0.01,
                display: 'number',
            },
            {
                name: 'start_percent',
                label: 'Start Percent',
                widgetType: 'FLOAT',
                default: 0.15,
                min: 0,
                max: 1,
                step: 0.01,
                display: 'number',
            },
            {
                name: 'end_percent',
                label: 'End Percent',
                widgetType: 'FLOAT',
                default: 0.95,
                min: 0,
                max: 1,
                step: 0.01,
                display: 'number',
            },
            {
                name: 'verbose',
                label: 'Verbose',
                widgetType: 'BOOLEAN',
                default: false,
            },
        ]);
    });

    it('maps the MiniMax H3 scheduled attention patch controls in source order', () => {
        expect(comfyNodeRegistry.MiniMaxH3ScheduledSolAttentionPatch.widgets.map(({ name, widgetType, default: value }) => ({
            name,
            widgetType,
            default: value,
        }))).toEqual([
            { name: 'enabled', widgetType: 'BOOLEAN', default: true },
            { name: 'tau_start', widgetType: 'FLOAT', default: 2 },
            { name: 'tau_end', widgetType: 'FLOAT', default: 0.8 },
            { name: 'curve', widgetType: 'COMBO', default: 'linear' },
            { name: 'min_tokens', widgetType: 'INT', default: 8192 },
            { name: 'strict', widgetType: 'BOOLEAN', default: false },
            { name: 'dense_percent', widgetType: 'FLOAT', default: 0 },
            { name: 'thresh_type', widgetType: 'COMBO', default: 'diag' },
            { name: 'int8_qk', widgetType: 'BOOLEAN', default: false },
            { name: 'int8_pv', widgetType: 'BOOLEAN', default: false },
            { name: 'sink_conditioning', widgetType: 'COMBO', default: 'exact_kv' },
            { name: 'dense_blocks', widgetType: 'STRING', default: '' },
        ]);
    });

    // Legacy eleven-slot workflows must serialize their old sink and dense
    // values in place while explicitly adding the new required false toggle.
    it('serializes legacy MiniMax H3 widgets without shifting saved values', () => {
        const serialize = comfyNodeRegistry.MiniMaxH3ScheduledSolAttentionPatch.serializeWidgets;
        expect(serialize).toBeDefined();
        expect(serialize!([
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
        ])).toEqual({
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
            int8_pv: false,
        });
    });

    it('serializes each active ResizeImageMaskNode DynamicCombo branch', () => {
        const serialize = comfyNodeRegistry.ResizeImageMaskNode.serializeWidgets;
        expect(serialize).toBeDefined();
        expect(serialize!([
            { index: 0, value: 'scale dimensions' },
            { index: 1, value: 640 },
            { index: 2, value: 480 },
            { index: 3, value: 'center' },
            { index: 4, value: 'area' },
        ])).toEqual({
            resize_type: 'scale dimensions',
            'resize_type.width': 640,
            'resize_type.height': 480,
            'resize_type.crop': 'center',
            scale_method: 'area',
        });
        expect(serialize!([
            { index: 0, value: 'scale by multiplier' },
            { index: 1, value: 2 },
            { index: 2, value: 'lanczos' },
        ])).toEqual({
            resize_type: 'scale by multiplier',
            'resize_type.multiplier': 2,
            scale_method: 'lanczos',
        });
    });

    it('maps LTXVImgToVideoInplace widgets after its three connections', () => {
        expect(comfyNodeRegistry.LTXVImgToVideoInplace.widgets).toEqual([
            {
                name: 'strength',
                label: 'Strength',
                widgetType: 'FLOAT',
                default: 1,
                min: 0,
                max: 1,
                step: 0.01,
                display: 'slider',
            },
            {
                name: 'bypass',
                label: 'Bypass',
                widgetType: 'BOOLEAN',
                default: false,
            },
        ]);
    });

    it('maps BasicScheduler widgets in serialized order', () => {
        expect(comfyNodeRegistry.BasicScheduler.widgets).toEqual([
            {
                name: 'scheduler',
                label: 'Scheduler',
                widgetType: 'COMBO',
                options: ['normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta', 'linear_quadratic'],
                default: 'normal',
                tooltip: 'Noise schedule used to calculate the sigma values.',
            },
            {
                name: 'steps',
                label: 'Steps',
                widgetType: 'INT',
                default: 20,
                min: 1,
                max: 10000,
                step: 1,
                display: 'number',
                tooltip: 'Number of sampling steps used to generate the sigma schedule.',
            },
            {
                name: 'denoise',
                label: 'Denoise',
                widgetType: 'FLOAT',
                default: 1,
                min: 0,
                max: 1,
                step: 0.01,
                display: 'slider',
                tooltip: 'Denoising strength used to select the sigma range.',
            },
        ]);
    });

    it('maps MiniMaxH3ImageToVideo widget slots without connection inputs', () => {
        expect(comfyNodeRegistry.MiniMaxH3ImageToVideo.widgets).toEqual([
            {
                name: 'prompt',
                label: 'Prompt',
                widgetType: 'STRING',
                default: '',
                multiline: true,
                dynamicPrompts: true,
                tooltip: 'Text prompt describing the video to generate.',
            },
            {
                name: 'width',
                label: 'Width',
                widgetType: 'INT',
                default: 1344,
                min: 32,
                max: 16384,
                step: 32,
                display: 'number',
                tooltip: 'Output canvas width in pixels.',
            },
            {
                name: 'height',
                label: 'Height',
                widgetType: 'INT',
                default: 768,
                min: 32,
                max: 16384,
                step: 32,
                display: 'number',
                tooltip: 'Output canvas height in pixels.',
            },
            {
                name: 'length',
                label: 'Length',
                widgetType: 'INT',
                default: 124,
                min: 5,
                max: 3600,
                step: 17,
                display: 'number',
                tooltip: 'Frame count at 24 fps, aligned to the MiniMax H3 temporal grid.',
            },
        ]);
    });

    it('registers connection-only audio decode and preserves math labels', () => {
        expect(comfyNodeRegistry.BasicGuider.widgets).toEqual([]);
        expect(comfyNodeRegistry.VAEDecodeAudio.widgets).toEqual([]);
        expect(getWidgetLabel('ComfyMathExpression', 0)).toBe('Expression');
        expect(getWidgetLabel('VAEDecodeAudio', 0)).toBe('#1');
    });

    // The turbo sampler is connection-only, so no phantom widget labels may be
    // introduced into the positional widgets_values mapping.
    it('registers MiniMax H3 Turbo Sampler without widget slots', () => {
        expect(comfyNodeRegistry.MiniMaxH3TurboSampler).toEqual({
            nodeType: 'MiniMaxH3TurboSampler',
            displayName: 'MiniMax-H3 Turbo Sampler (4-step)',
            category: 'MiniMaxH3Turbo',
            github: {
                repo: 'https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo',
                path: '__init__.py',
                extension: 'ComfyUI-MiniMax-H3-Turbo',
            },
            widgets: [],
        });
    });

    // The model connection is omitted from widgets_values; the three remaining
    // inputs must stay in the custom node's source order for prompt emission.
    it('maps MiniMax H3 Turbo LoRA widgets in source order', () => {
        expect(comfyNodeRegistry.MiniMaxH3TurboLoRA.widgets).toEqual([
            {
                name: 'lora_name',
                label: 'LoRA Name',
                widgetType: 'COMBO',
                options: [],
            },
            {
                name: 'strength',
                label: 'Strength',
                widgetType: 'FLOAT',
                default: 1.0,
                min: -10.0,
                max: 10.0,
                step: 0.01,
                display: 'number',
            },
            {
                name: 'low_vram',
                label: 'Low VRAM',
                widgetType: 'BOOLEAN',
                default: false,
                tooltip: 'Merge the LoRA for lower VRAM use at the cost of softer output on quantized bases.',
            },
        ]);
    });

    // The v0.30.0 comfy-core model connection is not a widget; both shift
    // controls therefore begin at widgets_values index zero.
    it('maps MiniMax H3 Sigma Shift controls in source order', () => {
        expect(comfyNodeRegistry.MiniMaxH3SigmaShift.widgets).toEqual([
            {
                name: 'shift_video',
                label: 'Shift Video',
                widgetType: 'FLOAT',
                default: 12.0,
                min: 0.01,
                max: 100.0,
                step: 0.01,
                display: 'number',
            },
            {
                name: 'shift_audio',
                label: 'Shift Audio',
                widgetType: 'FLOAT',
                default: 3.0,
                min: 0.01,
                max: 100.0,
                step: 0.01,
                display: 'number',
            },
        ]);
    });
});
