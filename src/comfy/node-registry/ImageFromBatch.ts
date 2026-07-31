import type { NodeWidgetLayout } from './types';

export const ImageFromBatch: NodeWidgetLayout = {
    nodeType: 'ImageFromBatch',
    displayName: 'Get Image from Batch',
    category: 'image/batch',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_images.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'batch_index',
            label: 'Batch Index',
            widgetType: 'INT',
            default: 0,
            min: -16384,
            max: 16384,
            step: 1,
            display: 'number',
            tooltip: 'The starting index within the batch.',
        },
        {
            name: 'length',
            label: 'Length',
            widgetType: 'INT',
            default: 1,
            min: 1,
            max: 4096,
            step: 1,
            display: 'number',
            tooltip: 'The number of images to extract from the batch.',
        },
    ],
};
