import type { NodeWidgetLayout } from './types';

// MiniMaxH3ImageToVideo has CLIP, VAE, first-frame, and last-frame inputs as
// connections; prompt, width, height, and length are its four widget slots.
export const MiniMaxH3ImageToVideo: NodeWidgetLayout = {
    nodeType: 'MiniMaxH3ImageToVideo',
    displayName: 'MiniMax H3 Image to Video',
    category: 'model/conditioning/minimax',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_minimax_h3.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'prompt',
            label: 'Prompt',
            widgetType: 'STRING',
            default: '',
            multiline: true,
            dynamicPrompts: true,
            tooltip: 'Text prompt describing the video to generate.',
        },
        {
            name: 'width',
            label: 'Width',
            widgetType: 'INT',
            default: 1344,
            min: 32,
            max: 16384,
            step: 32,
            display: 'number',
            tooltip: 'Output canvas width in pixels.',
        },
        {
            name: 'height',
            label: 'Height',
            widgetType: 'INT',
            default: 768,
            min: 32,
            max: 16384,
            step: 32,
            display: 'number',
            tooltip: 'Output canvas height in pixels.',
        },
        {
            name: 'length',
            label: 'Length',
            widgetType: 'INT',
            default: 124,
            min: 5,
            max: 3600,
            step: 17,
            display: 'number',
            tooltip: 'Frame count at 24 fps, aligned to the MiniMax H3 temporal grid.',
        },
    ],
};
