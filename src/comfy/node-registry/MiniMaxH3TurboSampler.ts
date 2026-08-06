import type { NodeWidgetLayout } from './types';

// MiniMaxH3TurboSampler exposes no widget inputs; it only creates the custom
// SAMPLER connection used by SamplerCustomAdvanced. Keeping an empty layout
// prevents the dashboard from treating the workflow node as unknown while
// preserving the fact that it contributes no widgets_values entries.
export const MiniMaxH3TurboSampler: NodeWidgetLayout = {
    nodeType: 'MiniMaxH3TurboSampler',
    displayName: 'MiniMax-H3 Turbo Sampler (4-step)',
    category: 'MiniMaxH3Turbo',
    github: {
        repo: 'https://github.com/Larryvrh/ComfyUI-MiniMax-H3-Turbo',
        path: '__init__.py',
        extension: 'ComfyUI-MiniMax-H3-Turbo',
    },
    widgets: [],
};
