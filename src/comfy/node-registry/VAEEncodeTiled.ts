import type { NodeWidgetLayout } from './types';

export const VAEEncodeTiled: NodeWidgetLayout = {
    nodeType: 'VAEEncodeTiled',
    displayName: 'VAE Encode (Tiled)',
    category: 'latent',
    widgets: [
        {
            name: 'tile_size',
            label: 'Tile Size',
            widgetType: 'INT',
            default: 512,
            min: 64,
            max: 8192,
            step: 64,
        },
        {
            name: 'overlap',
            label: 'Overlap',
            widgetType: 'INT',
            default: 64,
            min: 0,
            max: 8192,
            step: 32,
        },
    ],
};
