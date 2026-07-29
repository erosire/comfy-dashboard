import type { NodeWidgetLayout } from '../types';

export const SDXLPowerPromptSimplenegativethree: NodeWidgetLayout = {
    nodeType: 'SDXL Power Prompt - Simple / Negative (rgthree)',
    displayName: 'SDXL Power Prompt - Simple / Negative (rgthree)',
    category: 'rgthree',
    github: {
        repo: 'https://github.com/rgthree/rgthree-comfy',
        path: 'py/power_prompt.py',
        extension: 'rgthree-comfy',
    },
    widgets: [
        {
            name: 'prompt_g',
            label: 'Text (G)',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            dynamicPrompts: true,
        },
        {
            name: 'prompt_l',
            label: 'Text (L)',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            dynamicPrompts: true,
        },
    ],
};
