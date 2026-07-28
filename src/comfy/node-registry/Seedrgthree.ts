import type { NodeWidgetLayout } from './types';

export const Seedrgthree: NodeWidgetLayout = {
    nodeType: 'Seed (rgthree)',
    displayName: 'Seed (rgthree)',
    category: 'rgthree',
    github: {
        repo: 'https://github.com/rgthree/rgthree-comfy',
        path: 'py/seed.py',
        extension: 'rgthree-comfy',
    },
    widgets: [
        {
            name: 'seed',
            label: 'Seed',
            widgetType: 'INT',
            default: 0,
            min: -1125899906842624,
            max: 1125899906842624,
            display: 'number',
            linkedTo: 'control_after_generate',
            tooltip: 'Random seed for noise generation.',
        },
        {
            name: 'control_after_generate',
            label: 'Control After Generate',
            widgetType: 'COMBO',
            options: ['randomize', 'increment', 'decrement', 'keep'],
            default: 'randomize',
        },
    ],
};
