import type { NodeWidgetLayout } from './types';

export const DualCLIPLoader: NodeWidgetLayout = {
    nodeType: 'DualCLIPLoader',
    displayName: 'Dual CLIP Loader',
    category: 'loaders',
    widgets: [
        {
            name: 'clip_name1',
            label: 'CLIP Name 1',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'clip_name2',
            label: 'CLIP Name 2',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'type',
            label: 'Type',
            widgetType: 'COMBO',
            options: ['sdxl', 'sd3', 'flux', 'stable_audio'],
            default: 'sdxl',
        },
    ],
};
