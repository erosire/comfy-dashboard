import type { NodeWidgetLayout } from '../types';
import { UnetLoaderGGUF } from './UnetLoaderGGUF';
import { CLIPLoaderGGUF } from './CLIPLoaderGGUF';
import { DualCLIPLoaderGGUF } from './DualCLIPLoaderGGUF';
import { TripleCLIPLoaderGGUF } from './TripleCLIPLoaderGGUF';
import { QuadrupleCLIPLoaderGGUF } from './QuadrupleCLIPLoaderGGUF';
import { UnetLoaderGGUFAdvanced } from './UnetLoaderGGUFAdvanced';

export const ggufNodes: Record<string, NodeWidgetLayout> = {
    UnetLoaderGGUF,
    CLIPLoaderGGUF,
    DualCLIPLoaderGGUF,
    TripleCLIPLoaderGGUF,
    QuadrupleCLIPLoaderGGUF,
    UnetLoaderGGUFAdvanced,
};

export {
    UnetLoaderGGUF,
    CLIPLoaderGGUF,
    DualCLIPLoaderGGUF,
    TripleCLIPLoaderGGUF,
    QuadrupleCLIPLoaderGGUF,
    UnetLoaderGGUFAdvanced,
};
