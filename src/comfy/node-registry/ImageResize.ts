import type { NodeWidgetLayout } from './types';

export const ImageResize: NodeWidgetLayout = {
    nodeType: 'ImageResize',
    displayName: 'Image Resize',
    category: 'image/transform',
    github: {
        repo: 'https://github.com/comfyanonymous/ComfyUI',
        path: 'comfy_extras/nodes_image_resize.py',
        extension: 'ComfyUI',
    },
    widgets: [
        {
            name: 'width',
            label: 'Width',
            widgetType: 'INT',
            default: 512,
            min: 1,
            max: 16384,
        },
        {
            name: 'height',
            label: 'Height',
            widgetType: 'INT',
            default: 512,
            min: 1,
            max: 16384,
        },
        {
            name: 'interpolation',
            label: 'Interpolation',
            widgetType: 'COMBO',
            options: ['nearest', 'bilinear', 'bicubic', 'lanczos'],
            default: 'lanczos',
        },
        {
            name: 'method',
            label: 'Resize Method',
            widgetType: 'COMBO',
            options: ['stretch', 'crop', 'pad', 'pad_center'],
            default: 'stretch',
        },
        {
            name: 'antialias',
            label: 'Antialias',
            widgetType: 'BOOLEAN',
            default: true,
        },
    ],
};
