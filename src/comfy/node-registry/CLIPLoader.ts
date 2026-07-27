import type { NodeWidgetLayout } from './types';

export const CLIPLoader: NodeWidgetLayout = {
    nodeType: 'CLIPLoader',
    displayName: 'Load CLIP',
    category: 'loaders',
    widgets: [
        {
            name: 'clip_name',
            label: 'CLIP Name',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'type',
            label: 'Type',
            widgetType: 'COMBO',
            options: [
                'stable_diffusion', 'stable_cascade', 'sd3',
                'stable_audio', 'mochi', 'ltxv', 'pixart',
                'cosmos', 'lumina2', 'wan', 'hidream',
            ],
            default: 'stable_diffusion',
        },
    ],
};
