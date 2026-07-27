import type { NodeWidgetLayout } from './types';

export const CheckpointLoaderSimple: NodeWidgetLayout = {
    nodeType: 'CheckpointLoaderSimple',
    displayName: 'Load Checkpoint',
    category: 'loaders',
    widgets: [
        {
            name: 'ckpt_name',
            label: 'Checkpoint Name',
            widgetType: 'COMBO',
            options: [],
            tooltip: 'Select a checkpoint model file.',
        },
    ],
};
