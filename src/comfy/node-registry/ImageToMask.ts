import type { NodeWidgetLayout } from './types';

export const ImageToMask: NodeWidgetLayout = {
    nodeType: 'ImageToMask',
    displayName: 'Image to Mask',
    category: 'mask',
    widgets: [
        {
            name: 'channel',
            label: 'Channel',
            widgetType: 'COMBO',
            options: ['red', 'green', 'blue', 'alpha'],
            default: 'red',
        },
    ],
};
