import type { NodeWidgetLayout } from '../types';

export const VAELoaderKJ: NodeWidgetLayout = {
    nodeType: 'VAELoaderKJ',
    displayName: 'VAELoader KJ',
    category: 'KJNodes/vae',
    github: {
        repo: 'https://github.com/kijai/ComfyUI-KJNodes',
        path: 'nodes/nodes.py',
        extension: 'ComfyUI-KJNodes',
    },
    // INPUT_TYPES.required order (nodes/nodes.py VAELoaderKJ):
    //   vae_name, device, weight_dtype
    // vae_name is a server-side file list — like VAELoader/LatentUpscaleModelLoader,
    // an empty options list keeps the free-text field in the editor.
    widgets: [
        {
            name: 'vae_name',
            label: 'VAE Name',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'device',
            label: 'Device',
            widgetType: 'COMBO',
            options: ['main_device', 'cpu'],
            default: 'main_device',
        },
        {
            name: 'weight_dtype',
            label: 'Weight Dtype',
            widgetType: 'COMBO',
            options: ['bf16', 'fp16', 'fp32'],
            default: 'bf16',
        },
    ],
};
