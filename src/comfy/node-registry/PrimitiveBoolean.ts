import type { NodeWidgetLayout } from './types';

export const PrimitiveBoolean: NodeWidgetLayout = {
    nodeType: 'PrimitiveBoolean',
    displayName: 'Boolean',
    category: 'utilities/primitive',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_primitive.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'value',
            label: 'Value',
            widgetType: 'BOOLEAN',
            default: false,
        },
    ],
};
