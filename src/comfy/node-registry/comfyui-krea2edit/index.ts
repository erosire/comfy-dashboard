import type { NodeWidgetLayout } from '../types';
import { Krea2EditModelPatch } from './Krea2EditModelPatch';
import { Krea2EditGroundedEncode } from './Krea2EditGroundedEncode';

export const krea2editNodes: Record<string, NodeWidgetLayout> = {
    Krea2EditModelPatch,
    Krea2EditGroundedEncode,
};

export {
    Krea2EditModelPatch,
    Krea2EditGroundedEncode,
};
