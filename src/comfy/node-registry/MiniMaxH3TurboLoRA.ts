import type { NodeWidgetLayout } from './types';

// MiniMaxH3TurboLoRA receives the model by connection; the LoRA filename and
// three controls are serialized in this order after that connection input.
// `lora_name` options are intentionally empty because the available filenames
// are supplied by the running ComfyUI backend rather than the static registry.
// `low_vram` was added as a required backend input after older workflows were
// saved, so its false default is supplied during API prompt assembly when the
// legacy workflow has only the original two widget values.
export const MiniMaxH3TurboLoRA: NodeWidgetLayout = {
    nodeType: 'MiniMaxH3TurboLoRA',
    displayName: 'MiniMax-H3 Turbo LoRA',
    category: 'MiniMaxH3Turbo',
    github: {
        repo: 'https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo',
        path: '__init__.py',
        extension: 'ComfyUI-MiniMax-H3-Turbo',
    },
    promptDefaults: {
        low_vram: false,
    },
    widgets: [
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
    ],
};
