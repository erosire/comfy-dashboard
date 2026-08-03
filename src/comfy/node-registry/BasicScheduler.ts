import type { NodeWidgetLayout } from './types';
import { SCHEDULER_NAMES } from './types';

// BasicScheduler exposes the model as a connection, so only scheduler, steps,
// and denoise occupy the serialized widgets_values positions.
export const BasicScheduler: NodeWidgetLayout = {
    nodeType: 'BasicScheduler',
    displayName: 'Basic Scheduler',
    category: 'model/sampling/schedulers',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_custom_sampler.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'scheduler',
            label: 'Scheduler',
            widgetType: 'COMBO',
            options: [...SCHEDULER_NAMES],
            default: 'normal',
            tooltip: 'Noise schedule used to calculate the sigma values.',
        },
        {
            name: 'steps',
            label: 'Steps',
            widgetType: 'INT',
            default: 20,
            min: 1,
            max: 10000,
            step: 1,
            display: 'number',
            tooltip: 'Number of sampling steps used to generate the sigma schedule.',
        },
        {
            name: 'denoise',
            label: 'Denoise',
            widgetType: 'FLOAT',
            default: 1.0,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            display: 'slider',
            tooltip: 'Denoising strength used to select the sigma range.',
        },
    ],
};
