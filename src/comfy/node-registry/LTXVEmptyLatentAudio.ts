import type { NodeWidgetLayout } from './types';

export const LTXVEmptyLatentAudio: NodeWidgetLayout = {
    nodeType: 'LTXVEmptyLatentAudio',
    displayName: 'LTXV Empty Latent Audio',
    category: 'model/latent/ltxv',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_lt_audio.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'frames_number',
            label: 'Frames Number',
            widgetType: 'INT',
            default: 97,
            min: 1,
            max: 1000,
            step: 1,
            display: 'number',
            tooltip: 'Number of frames.',
        },
        {
            name: 'frame_rate',
            label: 'Frame Rate',
            widgetType: 'FLOAT',
            default: 25.0,
            min: 1.0,
            max: 1000.0,
            step: 0.01,
            display: 'number',
            tooltip: 'Number of frames per second.',
        },
        {
            name: 'batch_size',
            label: 'Batch Size',
            widgetType: 'INT',
            default: 1,
            min: 1,
            max: 4096,
            step: 1,
            display: 'number',
            tooltip: 'The number of latent audio samples in the batch.',
        },
    ],
};
