import type { NodeWidgetLayout } from './types';

export const EmptyFlux2LatentImage: NodeWidgetLayout = {
    nodeType: 'EmptyFlux2LatentImage',
    displayName: 'Empty Flux 2 Latent',
    category: 'latent/flux',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_flux.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'width',
            label: 'Width',
            widgetType: 'INT',
            default: 1024,
            min: 16,
            max: 8192,
            step: 16,
            display: 'number',
            tooltip: 'Width of the final image. Latent width = this / 16.',
        },
        {
            name: 'height',
            label: 'Height',
            widgetType: 'INT',
            default: 1024,
            min: 16,
            max: 8192,
            step: 16,
            display: 'number',
            tooltip: 'Height of the final image. Latent height = this / 16.',
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
            tooltip: 'Number of latent samples to generate.',
        },
    ],
};
