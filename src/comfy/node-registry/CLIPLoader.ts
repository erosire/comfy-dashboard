import type { NodeWidgetLayout } from './types';

export const CLIPLoader: NodeWidgetLayout = {
    nodeType: 'CLIPLoader',
    displayName: 'Load CLIP',
    category: 'loaders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_models.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'clip_name',
            label: 'CLIP Name',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'type',
            label: 'Type',
            widgetType: 'COMBO',
            options: [
                'stable_diffusion', 'stable_cascade', 'sd3',
                'stable_audio', 'mochi', 'ltxv', 'pixart',
                'cosmos', 'lumina2', 'wan', 'hidream',
            ],
            default: 'stable_diffusion',
        },
    ],
};
