import type { NodeWidgetLayout } from './types';

// BasicGuider receives its model and conditioning entirely through links, so
// the empty widget list preserves the node's connection-only prompt shape.
export const BasicGuider: NodeWidgetLayout = {
    nodeType: 'BasicGuider',
    displayName: 'Basic Guider',
    category: 'model/sampling/guiders',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_custom_sampler.py',
        extension: 'ComfyUI',
    },
    widgets: [],
};
