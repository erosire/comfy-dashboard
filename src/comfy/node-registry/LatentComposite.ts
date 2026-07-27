import type { NodeWidgetLayout } from './types';

export const LatentComposite: NodeWidgetLayout = {
    nodeType: 'LatentComposite',
    displayName: 'Latent Composite',
    category: 'latent/transform',
    widgets: [
        {
            name: 'x',
            label: 'X',
            widgetType: 'INT',
            default: 0,
            min: -16384,
            max: 16384,
        },
        {
            name: 'y',
            label: 'Y',
            widgetType: 'INT',
            default: 0,
            min: -16384,
            max: 16384,
        },
        {
            name: 'feather',
            label: 'Feather',
            widgetType: 'INT',
            default: 0,
            min: 0,
            max: 16384,
        },
    ],
};
