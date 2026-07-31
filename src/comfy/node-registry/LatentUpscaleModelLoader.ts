import type { NodeWidgetLayout } from './types';

export const LatentUpscaleModelLoader: NodeWidgetLayout = {
    nodeType: 'LatentUpscaleModelLoader',
    displayName: 'Load Latent Upscale Model',
    category: 'model/loaders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_hunyuan.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'model_name',
            label: 'Model Name',
            widgetType: 'COMBO',
            options: [],
        },
    ],
};
