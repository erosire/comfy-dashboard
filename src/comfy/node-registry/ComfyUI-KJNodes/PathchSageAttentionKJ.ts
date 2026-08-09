import type { NodeWidgetLayout } from '../types';

// The model input is a connection, while the Sage attention mode is a required
// combo widget and allow_compile is an optional boolean widget. The previous
// empty layout caused both values to be discarded from widgets_values, which
// made the updated backend reject otherwise valid workflows.
export const PathchSageAttentionKJ: NodeWidgetLayout = {
    nodeType: 'PathchSageAttentionKJ',
    displayName: 'Patch Sage Attention KJ',
    category: 'KJNodes/experimental',
    github: {
        repo: 'https://github.com/kijai/ComfyUI-KJNodes',
        // The node currently lives beside the other model optimization nodes;
        // keeping this path current makes the registry source link actionable.
        path: 'nodes/model_optimization_nodes.py',
        extension: 'ComfyUI-KJNodes',
    },
    // A missing Sage mode is safely disabled for legacy workflows so loading an
    // older graph never enables a dependency-backed attention implementation by
    // accident. Existing widget values still take precedence during serialization.
    promptDefaults: {
        sage_attention: 'disabled',
    },
    widgets: [
        {
            name: 'sage_attention',
            label: 'Sage Attention',
            widgetType: 'COMBO',
            options: [
                'disabled',
                'auto',
                'sageattn_qk_int8_pv_fp16_cuda',
                'sageattn_qk_int8_pv_fp16_triton',
                'sageattn_qk_int8_pv_fp8_cuda',
                'sageattn_qk_int8_pv_fp8_cuda++',
                'sageattn3',
                'sageattn3_per_block_mean',
            ],
            default: 'disabled',
            tooltip: 'Attention implementation used by the patched model.',
        },
        {
            name: 'allow_compile',
            label: 'Allow Compile',
            widgetType: 'BOOLEAN',
            default: false,
            optional: true,
            tooltip: 'Allow torch.compile for Sage attention when supported.',
        },
    ],
};
