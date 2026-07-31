import type { NodeWidgetLayout } from './types';

export const CFGGuider: NodeWidgetLayout = {
    nodeType: 'CFGGuider',
    displayName: 'CFG Guider',
    category: 'model/sampling/guiders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_custom_sampler.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'cfg',
            label: 'CFG',
            widgetType: 'FLOAT',
            default: 8.0,
            min: 0.0,
            max: 100.0,
            step: 0.1,
            round: 0.01,
            display: 'slider',
            tooltip: 'Classifier-Free Guidance scale.',
        },
    ],
};
