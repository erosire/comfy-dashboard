import type { NodeWidgetLayout } from './types';

export const ServerMemoryImageNode: NodeWidgetLayout = {
    nodeType: 'ServerMemoryImageNode',
    displayName: 'Server Memory Image Node',
    category: 'utils',
    github: {
        repo: 'https://github.com/comfyscript/ComfyUI-CloudClient',
        path: 'nodes/memory/MemoryImageNode.py',
        extension: 'ComfyUI-CloudClient',
    },
    widgets: [
        {
            name: 'cache_key',
            label: 'Cache Key',
            widgetType: 'STRING',
            default: 'image_1',
        },
        {
            name: 'operation',
            label: 'Operation',
            widgetType: 'COMBO',
            options: ['store', 'retrieve', 'upload', 'download', 'list_keys'],
            default: 'retrieve',
        },
        {
            name: 'remote_url',
            label: 'Remote URL',
            widgetType: 'STRING',
            default: '',
            optional: true,
        },
        {
            name: 'upload_data',
            label: 'Upload Data',
            widgetType: 'STRING',
            default: '',
            optional: true,
        },
    ],
};
