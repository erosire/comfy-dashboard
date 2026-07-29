import type { NodeWidgetLayout } from '../types';
import { LatentCrossFadeAutoConcat } from './LatentCrossFadeAutoConcat';
import { AudioLatentStretch } from './AudioLatentStretch';
import { LatentTemporalUpsampler } from './LatentTemporalUpsampler';
import { LatentMotionSharpener } from './LatentMotionSharpener';
import { LatentMotionRetime } from './LatentMotionRetime';
import { LatentTemporalInpainter } from './LatentTemporalInpainter';

export const tensNodes: Record<string, NodeWidgetLayout> = {
    LatentCrossFadeAutoConcat,
    AudioLatentStretch,
    LatentTemporalUpsampler,
    LatentMotionSharpener,
    LatentMotionRetime,
    LatentTemporalInpainter,
};

export {
    LatentCrossFadeAutoConcat,
    AudioLatentStretch,
    LatentTemporalUpsampler,
    LatentMotionSharpener,
    LatentMotionRetime,
    LatentTemporalInpainter,
};
