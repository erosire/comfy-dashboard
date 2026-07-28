import type { NodeWidgetLayout } from './types';

export const ModelSamplingFlux: NodeWidgetLayout = {
    nodeType: 'ModelSamplingFlux',
    displayName: 'Model Sampling Flux',
    category: 'model/advanced',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_flux.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'max_shift',
            label: 'Max Shift',
            widgetType: 'FLOAT',
            default: 0.0,
            min: -1e6,
            max: 1e6,
            step: 0.01,
        },
        {
            name: 'base_shift',
            label: 'Base Shift',
            widgetType: 'FLOAT',
            default: 0.0,
            min: -1e6,
            max: 1e6,
            step: 0.01,
        },
        {
            name: 'width',
            label: 'Width',
            widgetType: 'INT',
            default: 1024,
            min: 1,
            max: 16384,
        },
        {
            name: 'height',
            label: 'Height',
            widgetType: 'INT',
            default: 1024,
            min: 1,
            max: 16384,
        },
    ],
};
