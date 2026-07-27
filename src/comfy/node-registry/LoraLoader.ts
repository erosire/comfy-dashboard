import type { NodeWidgetLayout } from './types';

export const LoraLoader: NodeWidgetLayout = {
    nodeType: 'LoraLoader',
    displayName: 'Load LoRA',
    category: 'loaders',
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
            min: -20.0,
            max: 20.0,
            step: 0.01,
            display: 'number',
        },
        {
            name: 'strength_clip',
            label: 'CLIP Strength',
            widgetType: 'FLOAT',
            default: 1.0,
            min: -20.0,
            max: 20.0,
            step: 0.01,
            display: 'number',
        },
    ],
};
