import type { NodeWidgetLayout } from './types';

// PrimitiveInt (S&R: "PrimitiveInt", CNR: comfy-core, v0.16.0) — a v3 schema
// node (comfy_extras/nodes_primitive.py):
//   io.Int.Input("value", min=-sys.maxsize, max=sys.maxsize,
//                control_after_generate=io.ControlAfterGenerate.fixed)
// The min/max exceed the JS safe-integer range, which the editor's clamping
// treats as unbounded. The node also carries a second, control-mode widget
// (fixed/increment/…) which is intentionally NOT registered here — it has no
// API input (like Seed's "control_after_generate" companion) and prompt
// emission skips unregistered widget slots for registered nodes.
export const PrimitiveInt: NodeWidgetLayout = {
    nodeType: 'PrimitiveInt',
    displayName: 'Int',
    category: 'utilities/primitive',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_primitive.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'value',
            label: 'Value',
            widgetType: 'INT',
            default: 0,
            min: -0x7fffffffffffffff,
            max: 0x7fffffffffffffff,
            step: 1,
            display: 'number',
            tooltip: 'The integer value to output.',
        },
    ],
};
