import type { NodeWidgetLayout } from './types';

export const SaveImage: NodeWidgetLayout = {
    nodeType: 'SaveImage',
    displayName: 'Save Image',
    category: 'image',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'nodes.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'filename_prefix',
            label: 'Filename Prefix',
            widgetType: 'STRING',
            default: 'ComfyUI',
        },
    ],
};
