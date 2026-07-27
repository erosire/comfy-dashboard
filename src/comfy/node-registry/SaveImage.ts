import type { NodeWidgetLayout } from './types';

export const SaveImage: NodeWidgetLayout = {
    nodeType: 'SaveImage',
    displayName: 'Save Image',
    category: 'image',
    widgets: [
        {
            name: 'filename_prefix',
            label: 'Filename Prefix',
            widgetType: 'STRING',
            default: 'ComfyUI',
        },
    ],
};
