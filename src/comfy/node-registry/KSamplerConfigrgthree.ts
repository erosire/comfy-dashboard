import type { NodeWidgetLayout } from './types';
import { SAMPLER_NAMES, SCHEDULER_NAMES } from './types';

export const KSamplerConfigrgthree: NodeWidgetLayout = {
    nodeType: 'KSampler Config (rgthree)',
    displayName: 'KSampler Config (rgthree)',
    category: 'rgthree',
    github: {
        repo: 'https://github.com/rgthree/rgthree-comfy',
        path: 'py/ksampler_config.py',
        extension: 'rgthree-comfy',
    },
    widgets: [
        {
            name: 'steps_total',
            label: 'Steps',
            widgetType: 'INT',
            default: 30,
            min: 1,
            max: 10000,
            step: 1,
            display: 'number',
        },
        {
            name: 'refiner_step',
            label: 'Refiner Step',
            widgetType: 'INT',
            default: 24,
            min: 0,
            max: 10000,
            step: 1,
            display: 'number',
        },
        {
            name: 'cfg',
            label: 'CFG',
            widgetType: 'FLOAT',
            default: 8.0,
            min: 0.0,
            max: 100.0,
            step: 0.1,
            round: 0.01,
            display: 'slider',
        },
        {
            name: 'sampler_name',
            label: 'Sampler',
            widgetType: 'COMBO',
            options: [...SAMPLER_NAMES],
            default: 'euler',
        },
        {
            name: 'scheduler',
            label: 'Scheduler',
            widgetType: 'COMBO',
            options: [...SCHEDULER_NAMES],
            default: 'normal',
        },
    ],
};
