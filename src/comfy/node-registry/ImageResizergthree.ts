import type { NodeWidgetLayout } from './types';
import { UPSCALE_METHODS, CROP_MODES } from './types';

export const ImageResizergthree: NodeWidgetLayout = {
    nodeType: 'Image Resize (rgthree)',
    displayName: 'Image Resize (rgthree)',
    category: 'rgthree',
    github: {
        repo: 'https://github.com/rgthree/rgthree-comfy',
        path: 'py/image_resize.py',
        extension: 'rgthree-comfy',
    },
    widgets: [
        {
            name: 'measurement',
            label: 'Measurement',
            widgetType: 'COMBO',
            options: ['Pixels', 'Percentage'],
            default: 'Pixels',
        },
        {
            name: 'width',
            label: 'Width',
            widgetType: 'INT',
            default: 512,
            min: 1,
            max: 16384,
            step: 1,
            display: 'number',
        },
        {
            name: 'height',
            label: 'Height',
            widgetType: 'INT',
            default: 512,
            min: 1,
            max: 16384,
            step: 1,
            display: 'number',
        },
        {
            name: 'fit',
            label: 'Fit',
            widgetType: 'COMBO',
            options: ['crop', 'pad', 'contain'],
            default: 'crop',
        },
        {
            name: 'method',
            label: 'Method',
            widgetType: 'COMBO',
            options: [...UPSCALE_METHODS],
            default: 'nearest-exact',
        },
    ],
};
