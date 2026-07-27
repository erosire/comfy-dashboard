import type { NodeWidgetLayout } from './types';
import { UPSCALE_METHODS, CROP_MODES } from './types';

export const ImageScale: NodeWidgetLayout = {
    nodeType: 'ImageScale',
    displayName: 'Image Scale',
    category: 'image/transform',
    widgets: [
        {
            name: 'upscale_method',
            label: 'Upscale Method',
            widgetType: 'COMBO',
            options: [...UPSCALE_METHODS],
            default: 'nearest-exact',
        },
        {
            name: 'width',
            label: 'Width',
            widgetType: 'INT',
            default: 512,
            min: 1,
            max: 16384,
            step: 1,
        },
        {
            name: 'height',
            label: 'Height',
            widgetType: 'INT',
            default: 512,
            min: 1,
            max: 16384,
            step: 1,
        },
        {
            name: 'crop',
            label: 'Crop',
            widgetType: 'COMBO',
            options: [...CROP_MODES],
            default: 'center',
        },
    ],
};
