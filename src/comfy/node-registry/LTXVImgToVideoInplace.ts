import type { NodeWidgetLayout } from './types';

// The VAE, image, and latent values are connection inputs; only strength and
// bypass are serialized as widgets for this comfy-core v0.7.0 node.
export const LTXVImgToVideoInplace: NodeWidgetLayout = {
    nodeType: 'LTXVImgToVideoInplace',
    displayName: 'LTXV Img To Video Inplace',
    category: 'model/conditioning/ltxv',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_lt.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'strength',
            label: 'Strength',
            widgetType: 'FLOAT',
            default: 1,
            min: 0,
            max: 1,
            step: 0.01,
            display: 'slider',
        },
        {
            name: 'bypass',
            label: 'Bypass',
            widgetType: 'BOOLEAN',
            default: false,
        },
    ],
};
