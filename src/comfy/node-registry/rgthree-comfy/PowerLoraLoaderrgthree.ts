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
export const PowerLoraLoaderrgthree: NodeWidgetLayout = {
    nodeType: 'Power Lora Loader (rgthree)',
    displayName: 'Power Lora Loader (rgthree)',
    category: 'rgthree',
    github: {
        repo: 'https://github.com/rgthree/rgthree-comfy',
        path: 'py/power_lora_loader.py',
        extension: 'rgthree-comfy',
    },
    widgets: [],
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
            const obj = value as Record<string, unknown>;
            if (obj.type === 'PowerLoraLoaderHeaderWidget') {
                inputs.PowerLoraLoaderHeaderWidget = value;
                continue;
            }
            if ('lora' in obj && 'on' in obj) {
                loraIndex += 1;
                const lora = { ...obj };
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
