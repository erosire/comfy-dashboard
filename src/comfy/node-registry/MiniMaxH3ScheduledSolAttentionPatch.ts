import { arrayEach } from '@presource/core';
import type { NodeWidgetLayout } from './types';

// The model input is a connection; the remaining attention-patch controls are
// kept in this exact order because ComfyUI serializes them as widget slots.
// `dense_blocks` is required by the current ComfyUI-sol-attn node and must be
// included even when its default empty string means that every block is eligible
// for sparse attention; omitting it makes ComfyUI reject the whole prompt.
// `int8_pv` was inserted before `sink_conditioning` by the current node source.
// The serializer below recognizes both that current order and the older order
// so saved workflows retain their existing values while receiving the new false
// default required by the backend.
const currentWidgetNames = [
    'enabled',
    'tau_start',
    'tau_end',
    'curve',
    'min_tokens',
    'strict',
    'dense_percent',
    'thresh_type',
    'int8_qk',
    'int8_pv',
    'sink_conditioning',
    'dense_blocks',
] as const;

// Older workflows contain eleven values because int8_pv did not exist yet;
// their index nine value is sink_conditioning rather than a boolean toggle.
const legacyWidgetNames = [
    'enabled',
    'tau_start',
    'tau_end',
    'curve',
    'min_tokens',
    'strict',
    'dense_percent',
    'thresh_type',
    'int8_qk',
    'sink_conditioning',
    'dense_blocks',
] as const;

// Current workflows may omit a trailing empty dense_blocks widget, so checking
// the inserted boolean slot is more reliable than checking only array length.
const usesCurrentWidgetOrder = (
    widgets: ReadonlyArray<{ value: unknown; index: number }>,
): boolean =>
    widgets.length >= currentWidgetNames.length ||
    (typeof widgets[9]?.value === 'boolean' && typeof widgets[10]?.value === 'string');

export const MiniMaxH3ScheduledSolAttentionPatch: NodeWidgetLayout = {
    nodeType: 'MiniMaxH3ScheduledSolAttentionPatch',
    displayName: 'MiniMax H3 Scheduled Sol Attention Patch',
    category: 'model_patches/attention',
    github: {
        repo: 'https://github.com/Saganaki22/ComfyUI-sol-attn',
        path: 'minimax.py',
        extension: 'ComfyUI-sol-attn',
    },
    // A prompt assembled from an empty or legacy widget list still needs the
    // newly required backend inputs. Explicit serialized values override these.
    promptDefaults: {
        int8_pv: false,
        dense_blocks: '',
    },
    widgets: [
        {
            name: 'enabled',
            label: 'Enabled',
            widgetType: 'BOOLEAN',
            default: true,
        },
        {
            name: 'tau_start',
            label: 'Tau Start',
            widgetType: 'FLOAT',
            default: 2,
            min: 0,
            max: 4,
            step: 0.05,
            display: 'number',
        },
        {
            name: 'tau_end',
            label: 'Tau End',
            widgetType: 'FLOAT',
            default: 0.8,
            min: 0,
            max: 4,
            step: 0.05,
            display: 'number',
        },
        {
            name: 'curve',
            label: 'Curve',
            widgetType: 'COMBO',
            options: ['linear', 'cosine', 'sqrt', 'smoothstep', 'exponential', 'step'],
            default: 'linear',
        },
        {
            name: 'min_tokens',
            label: 'Min Tokens',
            widgetType: 'INT',
            default: 8192,
            min: 256,
            max: 131072,
            step: 256,
            display: 'number',
        },
        {
            name: 'strict',
            label: 'Strict',
            widgetType: 'BOOLEAN',
            default: false,
        },
        {
            name: 'dense_percent',
            label: 'Dense Percent',
            widgetType: 'FLOAT',
            default: 0,
            min: 0,
            max: 0.9,
            step: 0.05,
            display: 'number',
        },
        {
            name: 'thresh_type',
            label: 'Threshold Type',
            widgetType: 'COMBO',
            options: ['diag', 'exact'],
            default: 'diag',
        },
        {
            name: 'int8_qk',
            label: 'INT8 QK',
            widgetType: 'BOOLEAN',
            default: false,
        },
        {
            name: 'int8_pv',
            label: 'INT8 PV',
            widgetType: 'BOOLEAN',
            default: false,
            tooltip: 'Quantize the P×V attention product to INT8. Requires INT8 QK.',
        },
        {
            name: 'sink_conditioning',
            label: 'Sink Conditioning',
            widgetType: 'COMBO',
            options: ['exact_kv', 'exact_kv_and_rows', 'off'],
            default: 'exact_kv',
        },
        {
            name: 'dense_blocks',
            label: 'Dense Blocks',
            widgetType: 'STRING',
            default: '',
            tooltip: "Transformer blocks to keep dense, e.g. '0-2,-1'. Empty sparsifies all blocks.",
        },
    ],
    // Emit the current source order for new workflows while preserving the
    // eleven-slot order used by saved workflows created before int8_pv existed.
    serializeWidgets: (widgets) => {
        const names = usesCurrentWidgetOrder(widgets) ? currentWidgetNames : legacyWidgetNames;
        const inputs: Record<string, unknown> = {};

        // `arrayEach` keeps positional serialization aligned with the shared
        // core iteration contract used by other DynamicCombo registry nodes.
        arrayEach([...names], ({ index, value: name }) => {
            const widget = widgets[index];
            if (widget) inputs[name] = widget.value;
        });

        // Legacy arrays have no slot for int8_pv; the backend's opt-in default
        // must be emitted explicitly rather than inferred during validation.
        if (!usesCurrentWidgetOrder(widgets)) inputs.int8_pv = false;
        return inputs;
    },
};
