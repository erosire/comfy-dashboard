import type { NodeWidgetLayout } from './types';

export const LTXAVTextEncoderLoader: NodeWidgetLayout = {
    nodeType: 'LTXAVTextEncoderLoader',
    displayName: 'Load LTXV Audio Text Encoder',
    category: 'model/loaders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_lt_audio.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'text_encoder',
            label: 'Text Encoder',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'ckpt_name',
            label: 'Checkpoint Name',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'device',
            label: 'Device',
            widgetType: 'COMBO',
            options: ['default', 'cpu'],
            default: 'default',
            advanced: true,
        },
    ],
};
