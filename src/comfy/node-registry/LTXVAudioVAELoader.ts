import type { NodeWidgetLayout } from './types';

export const LTXVAudioVAELoader: NodeWidgetLayout = {
    nodeType: 'LTXVAudioVAELoader',
    displayName: 'Load LTXV Audio VAE',
    category: 'model/loaders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_lt_audio.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'ckpt_name',
            label: 'Checkpoint Name',
            widgetType: 'COMBO',
            options: [],
        },
    ],
};
