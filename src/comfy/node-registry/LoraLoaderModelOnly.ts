import type { NodeWidgetLayout } from './types';

export const LoraLoaderModelOnly: NodeWidgetLayout = {
    nodeType: 'LoraLoaderModelOnly',
    displayName: 'Load LoRA (Model Only)',
    category: 'loaders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'nodes.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'lora_name',
            label: 'LoRA Name',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'strength_model',
            label: 'Model Strength',
            widgetType: 'FLOAT',
            default: 1.0,
            min: -100.0,
            max: 100.0,
            step: 0.01,
            display: 'number',
        },
    ],
};
