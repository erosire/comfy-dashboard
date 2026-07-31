import type { NodeWidgetLayout } from './types';

export const LTXVPreprocess: NodeWidgetLayout = {
    nodeType: 'LTXVPreprocess',
    displayName: 'LTXV Preprocess',
    category: 'video/preprocessors',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_lt.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'img_compression',
            label: 'Image Compression',
            widgetType: 'INT',
            default: 35,
            min: 0,
            max: 100,
            step: 1,
            display: 'number',
            tooltip: 'Amount of compression to apply on image.',
        },
    ],
};
