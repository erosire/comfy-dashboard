import type { NodeWidgetLayout } from './types';

// MiniMaxH3SigmaShift is the v0.30.0 comfy-core node identified by the
// workflow metadata as S&R "MiniMaxH3SigmaShift". Its model input is a link,
// leaving the two flow-shift values as the only serialized widget slots.
export const MiniMaxH3SigmaShift: NodeWidgetLayout = {
    nodeType: 'MiniMaxH3SigmaShift',
    displayName: 'MiniMax H3 Sigma Shift',
    category: 'model/patch/minimax',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_minimax_h3.py',
        extension: 'comfy-core',
    },
    widgets: [
        {
            name: 'shift_video',
            label: 'Shift Video',
            widgetType: 'FLOAT',
            default: 12.0,
            min: 0.01,
            max: 100.0,
            step: 0.01,
            display: 'number',
        },
        {
            name: 'shift_audio',
            label: 'Shift Audio',
            widgetType: 'FLOAT',
            default: 3.0,
            min: 0.01,
            max: 100.0,
            step: 0.01,
            display: 'number',
        },
    ],
};
