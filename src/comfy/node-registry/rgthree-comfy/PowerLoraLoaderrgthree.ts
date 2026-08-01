import type { NodeWidgetLayout } from '../types';

// Power Lora Loader (rgthree) — widgets are DYNAMIC (py/power_lora_loader.py +
// src_web/comfyui/power_lora_loader.ts). The node carries a variable number of
// custom object widgets; `widgets_values` in a saved workflow is:
//
//   ["{}",                                     — RgthreeDividerWidget (serialize: false)
//    {"type": "PowerLoraLoaderHeaderWidget"},  — column header
//    {"on":…, "lora":…, "strength":…, "strengthTwo":…},  — "lora_1"
//    …per-lora objects…,                        — "lora_2", "lora_3", …
//    "{}",                                     — divider spacer (serialize: false)
//    ""]                                       — "➕ Add Lora" button
//
// The number of lora slots varies, so a static index→name registry cannot
// describe this node — hence `serializeWidgets`, mirroring rgthree's own
// frontend serialization: divider widgets (`{}`, serialize: false) are
// skipped, lora objects land under sequential "lora_N" keys, and in
// single-strength mode the stored `strengthTwo: null` is dropped from the
// prompt (rgthree's PowerLoraLoaderWidget.serializeValue deletes it unless
// "Separate Model & Clip" is active).

/** The node type string (class_type) of the rgthree Power Lora Loader. */
export const POWER_LORA_LOADER_NODE_TYPE = 'Power Lora Loader (rgthree)';

/** rgthree's "Show Strengths" property value that splits model & clip strength. */
export const POWER_LORA_LOADER_SEPARATE_STRENGTHS = 'Separate Model & Clip';

/**
 * A Power Lora Loader lora entry widget value. `strengthTwo` is the CLIP
 * strength — only meaningful when the node's "Show Strengths" property is
 * "Separate Model & Clip"; in single-strength mode it stays `null` (and is
 * dropped from the API prompt by serializeWidgets).
 */
export type PowerLoraEntry = {
    on: boolean;
    lora: string | null;
    strength: number;
    strengthTwo?: number | null;
};

/** Detect a lora entry widget value (`{"on":…, "lora":…, …}`). */
export function isPowerLoraEntry(value: unknown): value is PowerLoraEntry {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'lora' in value &&
        'on' in value
    );
}

/** Detect the PowerLoraLoaderHeaderWidget value (`{"type": "PowerLoraLoaderHeaderWidget"}`). */
export function isPowerLoraHeader(value: unknown): boolean {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as Record<string, unknown>).type === 'PowerLoraLoaderHeaderWidget'
    );
}

export const PowerLoraLoaderrgthree: NodeWidgetLayout = {
    nodeType: POWER_LORA_LOADER_NODE_TYPE,
    displayName: 'Power Lora Loader (rgthree)',
    category: 'rgthree',
    github: {
        repo: 'https://github.com/rgthree/rgthree-comfy',
        path: 'py/power_lora_loader.py',
        extension: 'rgthree-comfy',
    },
    widgets: [],
    // Dynamic labels: lora entries are numbered (counting lora objects only,
    // mirroring the serializer's lora_N naming); header, divider spacers and
    // the "➕ Add Lora" button get their own labels instead of bare "#N".
    widgetLabel: (widget, allWidgets) => {
        const { value } = widget;
        if (typeof value === 'string') return '➕ Add Lora';
        if (isPowerLoraHeader(value)) return 'Toggle All';
        if (isPowerLoraEntry(value)) {
            let n = 0;
            for (const w of allWidgets) {
                if (isPowerLoraEntry(w.value)) n += 1;
                if (w.index === widget.index) break;
            }
            return `LoRA ${n}`;
        }
        // Divider spacers ({}) and anything else — layout machinery, not a field.
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) return '—';
        return undefined;
    },
    serializeWidgets: (widgets) => {
        const inputs: Record<string, unknown> = {};
        let loraIndex = 0;
        for (const { value } of widgets) {
            // The trailing "➕ Add Lora" button is serialized as its empty
            // string value (RgthreeBetterButtonWidget has serialize: true).
            if (typeof value === 'string') {
                inputs['➕ Add Lora'] = value;
                continue;
            }
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
            if (isPowerLoraHeader(value)) {
                inputs.PowerLoraLoaderHeaderWidget = value;
                continue;
            }
            if (isPowerLoraEntry(value)) {
                loraIndex += 1;
                const lora = { ...value };
                // Single-strength mode keeps strengthTwo null in the
                // workflow file, but the prompt never carries it.
                if (lora.strengthTwo === null || lora.strengthTwo === undefined) {
                    delete lora.strengthTwo;
                }
                inputs[`lora_${loraIndex}`] = lora;
            }
            // Remaining objects are divider spacers ({}) — no API input.
        }
        return inputs;
    },
};
