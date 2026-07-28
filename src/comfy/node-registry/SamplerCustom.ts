import type { NodeWidgetLayout } from './types';

export const SamplerCustom: NodeWidgetLayout = {
    nodeType: 'SamplerCustom',
    displayName: 'Sampler Custom',
    category: 'sampling/custom_sampling',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_custom_sigmas.py',
        extension: 'ComfyUI',
    },
    widgets: [],
};
