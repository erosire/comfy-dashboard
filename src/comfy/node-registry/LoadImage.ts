import type { NodeWidgetLayout } from './types';

export const LoadImage: NodeWidgetLayout = {
    nodeType: 'LoadImage',
    displayName: 'Load Image',
    category: 'loaders/image',
    widgets: [
        {
            name: 'image',
            label: 'Image',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'upload',
            label: 'Upload',
            widgetType: 'IMAGEUPLOAD',
            imageFolder: 'input',
        },
    ],
};
