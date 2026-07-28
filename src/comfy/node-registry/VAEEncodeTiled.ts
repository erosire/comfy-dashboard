import type { NodeWidgetLayout } from './types';

export const VAEEncodeTiled: NodeWidgetLayout = {
    nodeType: 'VAEEncodeTiled',
    displayName: 'VAE Encode (Tiled)',
    category: 'latent',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_upscale_model.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'tile_size',
            label: 'Tile Size',
            widgetType: 'INT',
            default: 512,
            min: 64,
            max: 8192,
            step: 64,
        },
        {
            name: 'overlap',
            label: 'Overlap',
            widgetType: 'INT',
            default: 64,
            min: 0,
            max: 8192,
            step: 32,
        },
    ],
};
