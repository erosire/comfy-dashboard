import type { NodeWidgetLayout } from './types';

export const CheckpointLoader: NodeWidgetLayout = {
    nodeType: 'CheckpointLoader',
    displayName: 'Load Checkpoint (Advanced)',
    category: 'loaders',
    widgets: [
        {
            name: 'ckpt_name',
            label: 'Checkpoint Name',
            widgetType: 'COMBO',
            options: [],
        },
        {
            name: 'ckpt_config_name',
            label: 'Config Name',
            widgetType: 'COMBO',
            options: [],
        },
    ],
};
