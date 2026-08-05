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
        ]);
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
            { name: 'sink_conditioning', widgetType: 'COMBO', default: 'exact_kv' },
        ]);
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
});
