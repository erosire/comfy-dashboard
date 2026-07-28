import type { NodeWidgetLayout } from './types';

export const PowerPromptrgthree: NodeWidgetLayout = {
    nodeType: 'Power Prompt (rgthree)',
    displayName: 'Power Prompt (rgthree)',
    category: 'rgthree',
    github: {
        repo: 'https://github.com/rgthree/rgthree-comfy',
        path: 'py/power_prompt.py',
        extension: 'rgthree-comfy',
    },
    widgets: [
        {
            name: 'prompt',
            label: 'Prompt',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            dynamicPrompts: true,
            tooltip: 'Text prompt with support for LoRA and embedding insertion.',
        },
    ],
};
