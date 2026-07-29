import type { NodeWidgetLayout } from './types';

export const StringConcatenate: NodeWidgetLayout = {
    nodeType: 'StringConcatenate',
    displayName: 'Concatenate Text',
    category: 'text',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_string.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'string_a',
            label: 'String A',
            widgetType: 'STRING',
            multiline: true,
            default: '',
        },
        {
            name: 'string_b',
            label: 'String B',
            widgetType: 'STRING',
            multiline: true,
            default: '',
        },
        {
            name: 'delimiter',
            label: 'Delimiter',
            widgetType: 'STRING',
            default: '',
        },
    ],
};
