import type { NodeWidgetLayout } from './types';

export const PrimitiveStringMultiline: NodeWidgetLayout = {
    nodeType: 'PrimitiveStringMultiline',
    displayName: 'Text (Multiline)',
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
            widgetType: 'STRING',
            multiline: true,
            default: '',
        },
    ],
};
