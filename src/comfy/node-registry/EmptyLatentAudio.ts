import type { NodeWidgetLayout } from './types';

export const EmptyLatentAudio: NodeWidgetLayout = {
    nodeType: 'EmptyLatentAudio',
    displayName: 'Empty Latent Audio',
    category: 'latent/audio',
    widgets: [
        {
            name: 'seconds',
            label: 'Duration (seconds)',
            widgetType: 'FLOAT',
            default: 1.0,
            min: 0.1,
            max: 1200.0,
            step: 0.1,
        },
        {
            name: 'sample_rate',
            label: 'Sample Rate',
            widgetType: 'INT',
            default: 44100,
            min: 8000,
            max: 192000,
        },
    ],
};
