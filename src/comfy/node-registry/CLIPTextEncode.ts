import type { NodeWidgetLayout } from './types';

export const CLIPTextEncode: NodeWidgetLayout = {
    nodeType: 'CLIPTextEncode',
    displayName: 'CLIP Text Encode (Prompt)',
    category: 'conditioning',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'nodes.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'text',
            label: 'Text',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            dynamicPrompts: true,
            tooltip: 'Text prompt to encode. Supports embeddings and weighting.',
        },
    ],
};
