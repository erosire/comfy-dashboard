import type { NodeWidgetLayout } from '../types';

export const Krea2EditModelPatch: NodeWidgetLayout = {
    nodeType: 'Krea2EditModelPatch',
    displayName: 'Krea2 Edit (source patch)',
    category: 'krea2edit',
    github: {
        repo: 'https://github.com/lbouaraba/comfyui-krea2edit',
        path: '__init__.py',
        extension: 'comfyui-krea2edit',
    },
    widgets: [
        {
            name: 'ref_boost',
            label: 'Ref Boost',
            widgetType: 'FLOAT',
            default: 1.0,
            min: 0.0,
            max: 1000.0,
            step: 0.01,
            round: 0.001,
            display: 'number',
            tooltip: 'Reference-fidelity dial: multiplies target->reference attention. Applies to the LAST ref (= the subject in two-ref workflows, the only ref in single-ref). 1.0 = off, >1 pulls harder toward the reference\'s appearance, <1 loosens.',
            advanced: true,
        },
        {
            name: 'ref_boost_a',
            label: 'Ref Boost A (Scene)',
            widgetType: 'FLOAT',
            default: 1.0,
            min: 0.0,
            max: 1000.0,
            step: 0.01,
            round: 0.001,
            display: 'number',
            tooltip: 'Same dial for the FIRST ref (= the scene in two-ref workflows). No effect in single-ref workflows. 1.0 = off.',
            advanced: true,
        },
        {
            name: 'fit_mode',
            label: 'Fit Mode',
            widgetType: 'COMBO',
            options: ['fit', 'crop (legacy)'],
            default: 'fit',
            tooltip: 'How an image source fits a mismatched output aspect ratio (needs vae + source_image connected): fit = resample the source to the target grid at a centered offset — matches how this model was trained (default, use this); crop (legacy) = center-crop to the target AR then resize (v1/v1.1 geometry, only for older weights).',
            advanced: true,
        },
    ],
};
