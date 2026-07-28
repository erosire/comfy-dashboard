import type { NodeWidgetLayout } from './types';

export const EmptyLatentImage: NodeWidgetLayout = {
    nodeType: 'EmptyLatentImage',
    displayName: 'Empty Latent Image',
    category: 'latent',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'nodes.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'width',
            label: 'Width',
            widgetType: 'INT',
            default: 512,
            min: 16,
            max: 16384,
            step: 1,
            display: 'number',
            tooltip: 'The width of the latent image in pixels.',
        },
        {
            name: 'height',
            label: 'Height',
            widgetType: 'INT',
            default: 512,
            min: 16,
            max: 16384,
            step: 1,
            display: 'number',
            tooltip: 'The height of the latent image in pixels.',
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
            tooltip: 'Number of latent images to generate.',
        },
    ],
};
