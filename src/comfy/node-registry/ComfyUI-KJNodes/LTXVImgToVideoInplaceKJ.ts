import type { NodeWidgetLayout, WidgetDef } from '../types';

// LTXVImgToVideoInplaceKJ is a v3 DynamicCombo node (requires ComfyUI 0.8.1+).
// The "num_images" combo selects how many image groups are live; for the
// selected option N, the frontend serializes widgets_values as:
//   [num_images, strength_1, index_1, ..., strength_N, index_N]
// (image_i is a socket, never a widget entry). NOTE the order per group:
// STRENGTH comes BEFORE INDEX — verified against ComfyUI's own artifacts:
// a saved workflow's defaults serialize as ["1", 1, 0] (strength default
// 1.0 first, index default 0 second), and the matching API prompt reads
// { "num_images": "1", "num_images.strength_1": 1, "num_images.index_1": 0 }.
// (KJNodes' schema declares index_i before strength_i, but ComfyUI's
// frontend orders the expanded sub-widgets strength-first.)
// In the API prompt the schema-expanded ids are dotted: "num_images" holds
// the selected option key ("1".."20") and the slots are
// "num_images.strength_i" / "num_images.index_i"; the server nests them
// into a single dict argument via dynamic_paths (see comfy_api latest
// _io.py build_nested_inputs).
// Source: comfyui-kjnodes nodes/ltxv_nodes.py (1..20 images).
const dynamicImageWidgets: WidgetDef[] = [];
for (let i = 1; i <= 20; i++) {
    dynamicImageWidgets.push(
        {
            name: `num_images.strength_${i}`,
            label: `Image ${i} Strength`,
            widgetType: 'FLOAT',
            default: 1.0,
            min: 0.0,
            max: 1.0,
            step: 0.01,
            tooltip: `Strength for image ${i}.`,
        },
        {
            name: `num_images.index_${i}`,
            label: `Image ${i} Index`,
            widgetType: 'INT',
            default: 0,
            min: -9999,
            max: 9999,
            step: 1,
            optional: true,
            tooltip: `Frame index for image ${i} (in pixel space).`,
        },
    );
}

export const LTXVImgToVideoInplaceKJ: NodeWidgetLayout = {
    nodeType: 'LTXVImgToVideoInplaceKJ',
    displayName: 'LTXV Img To Video Inplace KJ',
    category: 'KJNodes/ltxv',
    github: {
        repo: 'https://github.com/kijai/ComfyUI-KJNodes',
        path: 'nodes/ltxv_nodes.py',
        extension: 'ComfyUI-KJNodes',
    },
    widgets: [
        {
            name: 'num_images',
            label: 'Number of Images',
            widgetType: 'COMBO',
            options: Array.from({ length: 20 }, (_, i) => String(i + 1)),
            default: '1',
        },
        ...dynamicImageWidgets,
    ],
};
