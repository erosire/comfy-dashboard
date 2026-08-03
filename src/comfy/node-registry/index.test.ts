import { describe, expect, it } from 'vitest';
import { comfyNodeRegistry, getWidgetLabel, isNodeRegistered } from './index';

// These entries cover the recently encountered built-in and MiniMax H3 S&R
// names; exact layouts protect positional widgets_values-to-input serialization.
describe('comfyNodeRegistry missing node entries', () => {
    it('registers every requested node type', () => {
        expect(['BasicGuider', 'BasicScheduler', 'ComfyMathExpression', 'MiniMaxH3ImageToVideo', 'VAEDecodeAudio'].map(isNodeRegistered)).toEqual([
            true,
            true,
            true,
            true,
            true,
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
