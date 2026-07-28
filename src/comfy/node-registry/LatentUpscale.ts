import type { NodeWidgetLayout } from './types';

export const LatentUpscale: NodeWidgetLayout = {
    nodeType: 'LatentUpscale',
    displayName: 'Latent Upscale',
    category: 'latent/transform',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'nodes.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'upscale_method',
            label: 'Upscale Method',
            widgetType: 'COMBO',
            options: ['nearest-exact', 'bilinear', 'area', 'bicubic'],
            default: 'nearest-exact',
        },
        {
            name: 'width',
            label: 'Width',
            widgetType: 'INT',
            default: 512,
            min: 1,
            max: 16384,
            step: 1,
        },
        {
            name: 'height',
            label: 'Height',
            widgetType: 'INT',
            default: 512,
            min: 1,
            max: 16384,
            step: 1,
        },
        {
            name: 'crop',
            label: 'Crop',
            widgetType: 'COMBO',
            options: ['disabled', 'center', 'padding'],
            default: 'disabled',
        },
    ],
};
