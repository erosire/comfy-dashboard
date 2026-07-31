import type { NodeWidgetLayout } from './types';
import { SAMPLER_NAMES } from './types';

export const KSamplerSelect: NodeWidgetLayout = {
    nodeType: 'KSamplerSelect',
    displayName: 'KSampler Select',
    category: 'model/sampling/samplers',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_custom_sampler.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'sampler_name',
            label: 'Sampler Name',
            widgetType: 'COMBO',
            options: [...SAMPLER_NAMES],
            default: 'euler',
            tooltip: 'The name of the sampler to use.',
        },
    ],
};
