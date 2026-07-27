import type { NodeWidgetLayout } from './types';

export const ConditioningSetTimestepRange: NodeWidgetLayout = {
    nodeType: 'ConditioningSetTimestepRange',
    displayName: 'Set Timestep Range',
    category: 'conditioning',
    widgets: [
        {
            name: 'start',
            label: 'Start',
            widgetType: 'FLOAT',
            default: 0.0,
            min: 0.0,
            max: 1.0,
            step: 0.001,
        },
        {
            name: 'end',
            label: 'End',
            widgetType: 'FLOAT',
            default: 1.0,
            min: 0.0,
            max: 1.0,
            step: 0.001,
        },
    ],
};
