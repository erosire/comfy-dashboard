import type { NodeWidgetLayout } from './types';

export const EmptySD3LatentImage: NodeWidgetLayout = {
    nodeType: 'EmptySD3LatentImage',
    displayName: 'Empty SD3 Latent',
    category: 'latent',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_sd3.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'width',
            label: 'Width',
            widgetType: 'INT',
            default: 1024,
            min: 16,
            max: 16384,
            step: 1,
            display: 'number',
        },
        {
            name: 'height',
            label: 'Height',
            widgetType: 'INT',
            default: 1024,
            min: 16,
            max: 16384,
            step: 1,
            display: 'number',
        },
        {
            name: 'batch_size',
            label: 'Batch Size',
            widgetType: 'INT',
            default: 1,
            min: 1,
            max: 4096,
            step: 1,
            display: 'number',
        },
    ],
};
