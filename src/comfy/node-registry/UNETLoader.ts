import type { NodeWidgetLayout } from './types';

export const UNETLoader: NodeWidgetLayout = {
    nodeType: 'UNETLoader',
    displayName: 'Load Diffusion Model',
    category: 'loaders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_models.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'unet_name',
            label: 'Model Name',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'weight_dtype',
            label: 'Weight Type',
            widgetType: 'COMBO',
            options: ['default', 'fp8_e4m3fn', 'fp8_e4m3fnfast', 'fp8_e5m2'],
            default: 'default',
        },
    ],
};
