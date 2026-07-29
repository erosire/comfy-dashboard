import type { NodeWidgetLayout } from './types';

export const ComfySwitchNode: NodeWidgetLayout = {
    nodeType: 'ComfySwitchNode',
    displayName: 'If/Else Switch',
    category: 'utilities/logic',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_logic.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'switch',
            label: 'Switch',
            widgetType: 'BOOLEAN',
            default: false,
        },
    ],
};
