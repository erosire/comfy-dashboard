import type { NodeWidgetLayout } from './types';

// TextGenerate uses a DynamicCombo ("sampling_mode") whose sub-widgets
// (temperature, top_k, top_p, min_p, repetition_penalty, seed,
// presence_penalty) are flattened into `widgets_values` in the workflow
// format. In the API prompt they are emitted with PREFIXED names
// (`sampling_mode.temperature`, `sampling_mode.top_k`, etc.) — the
// ComfyUI frontend creates each sub-widget with the name
// `${comboName}.${subKey}` (see dynamicWidgets.ts:dynamicComboWidget).
// The backend's schema validation expands the DynamicCombo and looks for
// these prefixed names via `dynamic_paths`.
//
// Widget order matches INPUT_TYPES() (comfy_extras/nodes_textgen.py):
//   prompt, max_length, sampling_mode,
//   temperature, top_k, top_p, min_p, repetition_penalty, seed,
//   presence_penalty, thinking, use_default_template
export const TextGenerate: NodeWidgetLayout = {
    nodeType: 'TextGenerate',
    displayName: 'Generate Text',
    category: 'text',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_textgen.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'prompt',
            label: 'Prompt',
            widgetType: 'STRING',
            multiline: true,
            dynamicPrompts: true,
            default: '',
        },
        {
            name: 'max_length',
            label: 'Max Length',
            widgetType: 'INT',
            default: 512,
            min: 1,
            max: 32768,
            display: 'number',
        },
        {
            name: 'sampling_mode',
            label: 'Sampling Mode',
            widgetType: 'COMBO',
            options: ['on', 'off'],
            default: 'on',
        },
        {
            name: 'sampling_mode.temperature',
            label: 'Temperature',
            widgetType: 'FLOAT',
            default: 0.7,
            min: 0.01,
            max: 2.0,
            step: 0.000001,
            display: 'number',
        },
        {
            name: 'sampling_mode.top_k',
            label: 'Top K',
            widgetType: 'INT',
            default: 64,
            min: 0,
            max: 1000,
            display: 'number',
        },
        {
            name: 'sampling_mode.top_p',
            label: 'Top P',
            widgetType: 'FLOAT',
            default: 0.95,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            display: 'number',
        },
        {
            name: 'sampling_mode.min_p',
            label: 'Min P',
            widgetType: 'FLOAT',
            default: 0.05,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            display: 'number',
        },
        {
            name: 'sampling_mode.repetition_penalty',
            label: 'Repetition Penalty',
            widgetType: 'FLOAT',
            default: 1.05,
            min: 0.0,
            max: 5.0,
            step: 0.01,
            display: 'number',
        },
        {
            name: 'sampling_mode.seed',
            label: 'Seed',
            widgetType: 'INT',
            default: 0,
            min: 0,
            max: 0xffffffffffffffff,
            display: 'number',
        },
        {
            name: 'sampling_mode.presence_penalty',
            label: 'Presence Penalty',
            widgetType: 'FLOAT',
            default: 0.0,
            min: 0.0,
            max: 5.0,
            step: 0.01,
            display: 'number',
            optional: true,
        },
        {
            name: 'thinking',
            label: 'Thinking',
            widgetType: 'BOOLEAN',
            default: false,
            optional: true,
        },
        {
            name: 'use_default_template',
            label: 'Use Default Template',
            widgetType: 'BOOLEAN',
            default: true,
            optional: true,
            advanced: true,
        },
    ],
};
