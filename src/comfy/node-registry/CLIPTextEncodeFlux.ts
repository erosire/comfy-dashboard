import type { NodeWidgetLayout } from './types';

export const CLIPTextEncodeFlux: NodeWidgetLayout = {
    nodeType: 'CLIPTextEncodeFlux',
    displayName: 'CLIP Text Encode (Flux)',
    category: 'conditioning',
    widgets: [
        {
            name: 'clip_l',
            label: 'CLIP L Prompt',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            dynamicPrompts: true,
        },
        {
            name: 't5xxl',
            label: 'T5XXL Prompt',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            dynamicPrompts: true,
        },
    ],
};
