import type { NodeWidgetLayout } from './types';

export const ResolutionSelector: NodeWidgetLayout = {
    nodeType: 'ResolutionSelector',
    displayName: 'Resolution Selector',
    category: 'utilities',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_resolution.py',
        extension: 'comfy-core',
    },
    widgets: [
        {
            name: 'aspect_ratio',
            label: 'Aspect Ratio',
            widgetType: 'COMBO',
            options: [
                '1:1 (Square)',
                '2:3 (Portrait Photo)',
                '3:2 (Photo)',
                '3:4 (Portrait Standard)',
                '4:3 (Standard)',
                '9:16 (Portrait Widescreen)',
                '16:9 (Widescreen)',
                '21:9 (Ultrawide)',
            ],
            default: '1:1 (Square)',
            tooltip: 'The aspect ratio for the output dimensions.',
        },
        {
            name: 'megapixels',
            label: 'Megapixels',
            widgetType: 'FLOAT',
            default: 1.0,
            min: 0.1,
            max: 16.0,
            step: 0.1,
            display: 'number',
            tooltip: 'Target total megapixels. 1.0 MP ≈ 1024x1024 for square.',
        },
        {
            name: 'multiple',
            label: 'Multiple',
            widgetType: 'INT',
            default: 8,
            min: 8,
            max: 128,
            step: 4,
            display: 'number',
            tooltip: 'Nearest multiple of the result to set the selected resolution to.',
            advanced: true,
        },
    ],
};
