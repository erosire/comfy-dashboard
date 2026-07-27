import type { NodeWidgetLayout } from './types';

export const VAELoader: NodeWidgetLayout = {
    nodeType: 'VAELoader',
    displayName: 'Load VAE',
    category: 'loaders',
    widgets: [
        {
            name: 'vae_name',
            label: 'VAE Name',
            widgetType: 'COMBO',
            options: [],
        },
    ],
};
