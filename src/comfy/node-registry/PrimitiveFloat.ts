import type { NodeWidgetLayout } from './types';

export const PrimitiveFloat: NodeWidgetLayout = {
    nodeType: 'PrimitiveFloat',
    displayName: 'Float',
    category: 'utilities/primitive',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'nodes.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'value',
            label: 'Value',
            widgetType: 'FLOAT',
            default: 0.0,
            step: 0.1,
            display: 'number',
            tooltip: 'The floating-point number value to output.',
        },
    ],
};
