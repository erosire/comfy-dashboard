import type { NodeWidgetLayout } from './types';

export const UniversalDataToAudioVideo: NodeWidgetLayout = {
    nodeType: 'UniversalDataToAudioVideo',
    displayName: 'Universal Data To Audio/Video (CloudClient)',
    category: 'media',
    github: {
        repo: 'https://github.com/comfyscript/ComfyUI-CloudClient',
        path: 'nodes/universal/UniversalDataToAudioVideo.py',
        extension: 'ComfyUI-CloudClient',
    },
    widgets: [
        {
            name: 'data_uri',
            label: 'Data URI',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            placeholder: 'Paste a data URI (data:video/mp4;base64,...), raw base64, or HTTP/HTTPS URL',
        },
    ],
};
