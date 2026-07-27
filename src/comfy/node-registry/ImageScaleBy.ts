import type { NodeWidgetLayout } from './types';
import { UPSCALE_METHODS } from './types';

export const ImageScaleBy: NodeWidgetLayout = {
    nodeType: 'ImageScaleBy',
    displayName: 'Image Scale By',
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
            name: 'scale_by',
            label: 'Scale Factor',
            widgetType: 'FLOAT',
            default: 1.0,
            min: 0.01,
            max: 8.0,
            step: 0.01,
            display: 'number',
        },
    ],
};
