import { arrayEach } from '@presource/core';
import type { NodeWidgetLayout } from './types';

// The DynamicCombo exposes one branch at a time. These are the branch values
// that are serialized after resize_type and before scale_method; connection-
// only values such as resize_type.match are intentionally not widget entries.
type ResizeType =
    | 'scale dimensions'
    | 'scale by multiplier'
    | 'scale longer dimension'
    | 'scale shorter dimension'
    | 'scale width'
    | 'scale height'
    | 'scale total pixels'
    | 'match size'
    | 'scale to multiple';

// These names mirror ComfyUI's DynamicCombo paths so API prompt conversion can
// preserve the selected branch without treating unused branch fields as input.
const dynamicWidgetNames: Record<ResizeType, readonly string[]> = {
    'scale dimensions': ['width', 'height', 'crop'],
    'scale by multiplier': ['multiplier'],
    'scale longer dimension': ['longer_size'],
    'scale shorter dimension': ['shorter_size'],
    'scale width': ['width'],
    'scale height': ['height'],
    'scale total pixels': ['megapixels'],
    'match size': ['crop'],
    'scale to multiple': ['multiple'],
};

// Labels follow the active DynamicCombo branch, while the static widget defs
// describe the default scale-dimensions branch for editor controls and bounds.
const dynamicWidgetLabels: Record<ResizeType, readonly string[]> = {
    'scale dimensions': ['Resize Type', 'Width', 'Height', 'Crop', 'Scale Method'],
    'scale by multiplier': ['Resize Type', 'Multiplier', 'Scale Method'],
    'scale longer dimension': ['Resize Type', 'Longer Size', 'Scale Method'],
    'scale shorter dimension': ['Resize Type', 'Shorter Size', 'Scale Method'],
    'scale width': ['Resize Type', 'Width', 'Scale Method'],
    'scale height': ['Resize Type', 'Height', 'Scale Method'],
    'scale total pixels': ['Resize Type', 'Megapixels', 'Scale Method'],
    'match size': ['Resize Type', 'Crop', 'Scale Method'],
    'scale to multiple': ['Resize Type', 'Multiple', 'Scale Method'],
};

const resizeTypeOptions: readonly ResizeType[] = [
    'scale dimensions',
    'scale by multiplier',
    'scale longer dimension',
    'scale shorter dimension',
    'scale width',
    'scale height',
    'scale total pixels',
    'match size',
    'scale to multiple',
];

const scaleMethodOptions = ['nearest-exact', 'bilinear', 'area', 'bicubic', 'lanczos'];
const cropOptions = ['disabled', 'center'];

// ResizeImageMaskNode is a comfy-core node introduced in v0.7.0. Its model
// registry metadata is represented by the ComfyUI source reference below; the
// shared NodeWidgetLayout type intentionally stores source, not CNR/version.
export const ResizeImageMaskNode: NodeWidgetLayout = {
    nodeType: 'ResizeImageMaskNode',
    displayName: 'Resize Image/Mask',
    category: 'image/transform',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_post_processing.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'resize_type',
            label: 'Resize Type',
            widgetType: 'COMBO',
            options: [...resizeTypeOptions],
            default: 'scale dimensions',
        },
        {
            name: 'resize_type.width',
            label: 'Width',
            widgetType: 'INT',
            default: 512,
            min: 0,
            max: 16384,
            step: 1,
            display: 'number',
        },
        {
            name: 'resize_type.height',
            label: 'Height',
            widgetType: 'INT',
            default: 512,
            min: 0,
            max: 16384,
            step: 1,
            display: 'number',
        },
        {
            name: 'resize_type.crop',
            label: 'Crop',
            widgetType: 'COMBO',
            options: [...cropOptions],
            default: 'center',
        },
        {
            name: 'scale_method',
            label: 'Scale Method',
            widgetType: 'COMBO',
            options: [...scaleMethodOptions],
            default: 'area',
        },
    ],
    // DynamicCombo values are flattened in workflow JSON but use dotted names
    // in API prompts. Map only the active branch and keep scale_method last.
    serializeWidgets: (widgets) => {
        const firstValue = widgets[0]?.value as ResizeType;
        const resizeType = resizeTypeOptions.includes(firstValue) ? firstValue : 'scale dimensions';
        const inputs: Record<string, unknown> = { resize_type: resizeType };
        const fieldNames = dynamicWidgetNames[resizeType];

        arrayEach([...fieldNames], ({ index, value: fieldName }) => {
            inputs[`resize_type.${fieldName}`] = widgets[index + 1]?.value;
        });

        // The scale-method slot follows the selected branch's dynamic fields.
        inputs.scale_method = widgets[fieldNames.length + 1]?.value;
        return inputs;
    },
    // Dynamic labels keep non-default branches readable even though the static
    // widget definitions are necessarily anchored to one branch's controls.
    widgetLabel: (widget, allWidgets) => {
        const selected = allWidgets[0]?.value as ResizeType;
        const resizeType = resizeTypeOptions.includes(selected) ? selected : 'scale dimensions';
        return dynamicWidgetLabels[resizeType][widget.index];
    },
};
