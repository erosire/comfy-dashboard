import type { NodeWidgetLayout } from './types';

export const ComfyMathExpression: NodeWidgetLayout = {
    nodeType: 'ComfyMathExpression',
    displayName: 'Math Expression',
    category: 'utilities',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_math.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'expression',
            label: 'Expression',
            widgetType: 'STRING',
            default: 'a + b',
            multiline: true,
            tooltip: 'The mathematical expression to evaluate. Supports variables (a, b, c, ...) and functions (sum, min, max, abs, pow, sqrt, etc.).',
        },
    ],
};
