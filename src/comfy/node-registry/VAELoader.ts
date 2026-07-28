import type { NodeWidgetLayout } from './types';

export const VAELoader: NodeWidgetLayout = {
    nodeType: 'VAELoader',
    displayName: 'Load VAE',
    category: 'loaders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_models.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'vae_name',
            label: 'VAE Name',
            widgetType: 'COMBO',
            options: [],
        },
    ],
};
