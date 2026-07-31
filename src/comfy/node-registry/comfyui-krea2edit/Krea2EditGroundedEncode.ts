import type { NodeWidgetLayout } from '../types';

export const Krea2EditGroundedEncode: NodeWidgetLayout = {
    nodeType: 'Krea2EditGroundedEncode',
    displayName: 'Krea2 Edit (grounded encode)',
    category: 'krea2edit',
    github: {
        repo: 'https://github.com/lbouaraba/comfyui-krea2edit',
        path: '__init__.py',
        extension: 'comfyui-krea2edit',
    },
    widgets: [
        {
            name: 'prompt',
            label: 'Prompt',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            placeholder: 'Edit instruction, e.g. "recolor the car to matte black"',
            tooltip: 'The edit instruction for image editing.',
        },
        {
            name: 'grounding_px',
            label: 'Grounding Resolution',
            widgetType: 'INT',
            default: 768,
            min: 0,
            max: 4096,
            step: 64,
            display: 'number',
            tooltip: 'Cap longest side fed to Qwen3-VL; 0 = native resolution. Lower = stronger edit adherence, higher = stronger identity/likeness. Try 1024 for people, 512 for stubborn scene changes.',
            advanced: true,
        },
        {
            name: 'system_prompt',
            label: 'System Prompt',
            widgetType: 'STRING',
            multiline: true,
            default: '',
            placeholder: 'Advanced: override the grounding system prompt (empty = training default)',
            tooltip: 'Advanced: override the grounding system prompt (empty = training default). Steers what the vision encoder attends to, e.g. facial identity detail.',
            advanced: true,
        },
    ],
};
