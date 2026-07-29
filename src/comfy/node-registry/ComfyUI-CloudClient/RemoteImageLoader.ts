import type { NodeWidgetLayout } from '../types';

export const RemoteImageLoader: NodeWidgetLayout = {
    nodeType: 'RemoteImageLoader',
    displayName: 'Remote Image Loader',
    category: 'image/loaders',
    github: {
        repo: 'https://github.com/comfyscript/ComfyUI-CloudClient',
        path: 'nodes/remote/RemoteImageLoader.py',
        extension: 'ComfyUI-CloudClient',
    },
    widgets: [
        {
            name: 'url',
            label: 'URL',
            widgetType: 'STRING',
            default: '',
            placeholder: 'https://example.com/image.png',
        },
        {
            name: 'timeout',
            label: 'Timeout',
            widgetType: 'INT',
            default: 30,
            min: 5,
            max: 120,
            step: 1,
            display: 'number',
        },
    ],
};
