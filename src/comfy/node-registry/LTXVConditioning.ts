import type { NodeWidgetLayout } from './types';

export const LTXVConditioning: NodeWidgetLayout = {
    nodeType: 'LTXVConditioning',
    displayName: 'LTXV Conditioning',
    category: 'model/conditioning/ltxv',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_lt.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'frame_rate',
            label: 'Frame Rate',
            widgetType: 'FLOAT',
            default: 25.0,
            min: 0.0,
            max: 1000.0,
            step: 0.01,
            display: 'number',
            tooltip: 'The frame rate to apply to the conditioning.',
        },
    ],
};
