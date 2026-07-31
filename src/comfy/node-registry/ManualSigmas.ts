import type { NodeWidgetLayout } from './types';

export const ManualSigmas: NodeWidgetLayout = {
    nodeType: 'ManualSigmas',
    displayName: 'Manual Sigmas',
    category: 'model/sampling/sigmas',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_custom_sampler.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'sigmas',
            label: 'Sigmas',
            widgetType: 'STRING',
            default: '1, 0.5',
            multiline: false,
            tooltip: 'A comma or space separated list of sigma values.',
        },
    ],
};
