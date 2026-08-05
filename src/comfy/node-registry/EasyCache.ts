import type { NodeWidgetLayout } from './types';

// EasyCache receives the model through a connection, so only its four scalar
// controls occupy widgets_values and need positional registry definitions.
export const EasyCache: NodeWidgetLayout = {
    nodeType: 'EasyCache',
    displayName: 'EasyCache',
    category: 'advanced/debug',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_easycache.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'reuse_threshold',
            label: 'Reuse Threshold',
            widgetType: 'FLOAT',
            default: 0.2,
            min: 0,
            max: 3,
            step: 0.01,
            display: 'number',
        },
        {
            name: 'start_percent',
            label: 'Start Percent',
            widgetType: 'FLOAT',
            default: 0.15,
            min: 0,
            max: 1,
            step: 0.01,
            display: 'number',
        },
        {
            name: 'end_percent',
            label: 'End Percent',
            widgetType: 'FLOAT',
            default: 0.95,
            min: 0,
            max: 1,
            step: 0.01,
            display: 'number',
        },
        {
            name: 'verbose',
            label: 'Verbose',
            widgetType: 'BOOLEAN',
            default: false,
        },
    ],
};
