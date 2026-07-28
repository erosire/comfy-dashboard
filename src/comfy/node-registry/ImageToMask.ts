import type { NodeWidgetLayout } from './types';

export const ImageToMask: NodeWidgetLayout = {
    nodeType: 'ImageToMask',
    displayName: 'Image to Mask',
    category: 'mask',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'nodes.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'channel',
            label: 'Channel',
            widgetType: 'COMBO',
            options: ['red', 'green', 'blue', 'alpha'],
            default: 'red',
        },
    ],
};
