import type { NodeWidgetLayout } from './types';

export const ClientVideoDownloadNode: NodeWidgetLayout = {
    nodeType: 'ClientVideoDownloadNode',
    displayName: 'Client Video Download',
    category: 'video',
    github: {
        repo: 'https://github.com/comfyscript/ComfyUI-CloudClient',
        path: 'nodes/client/ClientVideoSaveNode.py',
        extension: 'ComfyUI-CloudClient',
    },
    widgets: [
        {
            name: 'prefix',
            label: 'Prefix',
            widgetType: 'STRING',
            default: 'animated',
        },
        {
            name: 'fps',
            label: 'FPS',
            widgetType: 'INT',
            default: 16,
            min: 1,
            max: 60,
            step: 1,
            display: 'number',
        },
        {
            name: 'quality',
            label: 'Quality',
            widgetType: 'INT',
            default: 23,
            min: 0,
            max: 51,
            step: 1,
            display: 'number',
        },
        {
            name: 'format',
            label: 'Format',
            widgetType: 'COMBO',
            options: ['webm', 'mp4', 'gif'],
            default: 'webm',
        },
    ],
};
