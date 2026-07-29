import type { NodeWidgetLayout } from '../types';

export const TextBox1: NodeWidgetLayout = {
    nodeType: 'TextBox1',
    displayName: 'Text Box 1',
    category: 'text',
    widgets: [
        {
            name: 'text1',
            label: 'Text 1',
            widgetType: 'STRING',
            multiline: true,
            default: '',
        },
    ],
};
