import type { NodeWidgetLayout } from './types';

export const DualCLIPLoader: NodeWidgetLayout = {
    nodeType: 'DualCLIPLoader',
    displayName: 'Dual CLIP Loader',
    category: 'loaders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_models.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'clip_name1',
            label: 'CLIP Name 1',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'clip_name2',
            label: 'CLIP Name 2',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'type',
            label: 'Type',
            widgetType: 'COMBO',
            options: ['sdxl', 'sd3', 'flux', 'stable_audio'],
            default: 'sdxl',
        },
    ],
};
