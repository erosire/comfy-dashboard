import type { NodeWidgetLayout } from './types';

export const UniversalDataToImage: NodeWidgetLayout = {
    nodeType: 'UniversalDataToImage',
    displayName: 'Universal Data To Image (CloudClient)',
    category: 'image',
    github: {
        repo: 'https://github.com/comfyscript/ComfyUI-CloudClient',
        path: 'nodes/universal/UniversalDataToImage.py',
        extension: 'ComfyUI-CloudClient',
    },
    widgets: [
        {
            name: 'data_uri',
            label: 'Data URI',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            placeholder: 'Paste a data URI (data:image/png;base64,...), raw base64, or HTTP/HTTPS URL',
        },
    ],
};
