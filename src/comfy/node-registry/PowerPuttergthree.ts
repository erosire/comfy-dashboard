import type { NodeWidgetLayout } from './types';

export const PowerPuttergthree: NodeWidgetLayout = {
    nodeType: 'Power Puter (rgthree)',
    displayName: 'Power Puter (rgthree)',
    category: 'rgthree',
    github: {
        repo: 'https://github.com/rgthree/rgthree-comfy',
        path: 'py/power_puter.py',
        extension: 'rgthree-comfy',
    },
    widgets: [
        {
            name: 'code',
            label: 'Code',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            tooltip: 'Python code to evaluate. Supports math, string ops, node access, etc.',
        },
        {
            name: 'outputs',
            label: 'Outputs',
            widgetType: 'COMBO',
            options: ['STRING', 'INT', 'FLOAT', 'BOOLEAN'],
            default: 'STRING',
        },
    ],
};
