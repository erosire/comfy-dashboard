import type { NodeWidgetLayout } from './types';

export const RandomNoise: NodeWidgetLayout = {
    nodeType: 'RandomNoise',
    displayName: 'Random Noise',
    category: 'model/sampling/noise',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_custom_sampler.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'noise_seed',
            label: 'Noise Seed',
            widgetType: 'INT',
            default: 0,
            min: 0,
            max: 0xffffffffffffffff,
            display: 'number',
            linkedTo: 'control_after_generate',
            tooltip: 'The seed used for generating random noise.',
        },
    ],
};
