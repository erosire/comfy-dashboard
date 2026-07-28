import type { NodeWidgetLayout } from './types';

export const ClientImageDownloadNode: NodeWidgetLayout = {
    nodeType: 'ClientImageDownloadNode',
    displayName: 'Client Image Download',
    category: 'image',
    github: {
        repo: 'https://github.com/comfyscript/ComfyUI-CloudClient',
        path: 'nodes/client/ClientImageSaveNode.py',
        extension: 'ComfyUI-CloudClient',
    },
    widgets: [
        {
            name: 'prefix',
            label: 'Prefix',
            widgetType: 'STRING',
            default: 'kaggle_generated',
        },
        {
            name: 'file_format',
            label: 'File Format',
            widgetType: 'COMBO',
            options: ['PNG', 'JPEG', 'GIF'],
            default: 'PNG',
        },
    ],
};
