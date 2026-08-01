import type { NodeWidgetLayout } from '../types';
import { AnySwitchrgthree } from './AnySwitchrgthree';
import { ContextBigrgthree } from './ContextBigrgthree';
import { Contextrgthree } from './Contextrgthree';
import { ContextMergeBigrgthree } from './ContextMergeBigrgthree';
import { ContextMergergthree } from './ContextMergergthree';
import { ContextSwitchBigrgthree } from './ContextSwitchBigrgthree';
import { ContextSwitchrgthree } from './ContextSwitchrgthree';
import { DisplayAnyrgthree } from './DisplayAnyrgthree';
import { DisplayIntrgthree } from './DisplayIntrgthree';
import { DynamicContextSwitchrgthree } from './DynamicContextSwitchrgthree';
import { DynamicContextrgthree } from './DynamicContextrgthree';
import { FastGroupsMuterthree } from './FastGroupsMuterthree';
import { ImageComparerrgthree } from './ImageComparerrgthree';
import { ImageInsetCropprgthree } from './ImageInsetCropprgthree';
import { ImageOrLatentSizergthree } from './ImageOrLatentSizergthree';
import { ImageResizergthree } from './ImageResizergthree';
import { KSamplerConfigrgthree } from './KSamplerConfigrgthree';
import { LoraLoaderStackrgthree } from './LoraLoaderStackrgthree';
import { PowerLoraLoaderrgthree } from './PowerLoraLoaderrgthree';
import { PowerPrimitivergthree } from './PowerPrimitivergthree';
import { PowerPromptrgthree } from './PowerPromptrgthree';
import { PowerPromptSimplergthree } from './PowerPromptSimplergthree';
import { PowerPuttergthree } from './PowerPuttergthree';
import { SDXLEmptyLatentImagergthree } from './SDXLEmptyLatentImagergthree';
import { SDXLPowerPromptPositivergthree } from './SDXLPowerPromptPositivergthree';
import { SDXLPowerPromptSimplenegativethree } from './SDXLPowerPromptSimplenegativethree';
import { Seedrgthree } from './Seedrgthree';

export const rgthreeNodes: Record<string, NodeWidgetLayout> = {
    [AnySwitchrgthree.nodeType]: AnySwitchrgthree,
    [ContextBigrgthree.nodeType]: ContextBigrgthree,
    [Contextrgthree.nodeType]: Contextrgthree,
    [ContextMergeBigrgthree.nodeType]: ContextMergeBigrgthree,
    [ContextMergergthree.nodeType]: ContextMergergthree,
    [ContextSwitchBigrgthree.nodeType]: ContextSwitchBigrgthree,
    [ContextSwitchrgthree.nodeType]: ContextSwitchrgthree,
    [DisplayAnyrgthree.nodeType]: DisplayAnyrgthree,
    [DisplayIntrgthree.nodeType]: DisplayIntrgthree,
    [DynamicContextSwitchrgthree.nodeType]: DynamicContextSwitchrgthree,
    [DynamicContextrgthree.nodeType]: DynamicContextrgthree,
    [FastGroupsMuterthree.nodeType]: FastGroupsMuterthree,
    [ImageComparerrgthree.nodeType]: ImageComparerrgthree,
    [ImageInsetCropprgthree.nodeType]: ImageInsetCropprgthree,
    [ImageOrLatentSizergthree.nodeType]: ImageOrLatentSizergthree,
    [ImageResizergthree.nodeType]: ImageResizergthree,
    [KSamplerConfigrgthree.nodeType]: KSamplerConfigrgthree,
    [LoraLoaderStackrgthree.nodeType]: LoraLoaderStackrgthree,
    [PowerLoraLoaderrgthree.nodeType]: PowerLoraLoaderrgthree,
    [PowerPrimitivergthree.nodeType]: PowerPrimitivergthree,
    [PowerPromptrgthree.nodeType]: PowerPromptrgthree,
    [PowerPromptSimplergthree.nodeType]: PowerPromptSimplergthree,
    [PowerPuttergthree.nodeType]: PowerPuttergthree,
    [SDXLEmptyLatentImagergthree.nodeType]: SDXLEmptyLatentImagergthree,
    [SDXLPowerPromptPositivergthree.nodeType]: SDXLPowerPromptPositivergthree,
    [SDXLPowerPromptSimplenegativethree.nodeType]: SDXLPowerPromptSimplenegativethree,
    [Seedrgthree.nodeType]: Seedrgthree,
};

export {
    AnySwitchrgthree,
    ContextBigrgthree,
    Contextrgthree,
    ContextMergeBigrgthree,
    ContextMergergthree,
    ContextSwitchBigrgthree,
    ContextSwitchrgthree,
    DisplayAnyrgthree,
    DisplayIntrgthree,
    DynamicContextSwitchrgthree,
    DynamicContextrgthree,
    FastGroupsMuterthree,
    ImageComparerrgthree,
    ImageInsetCropprgthree,
    ImageOrLatentSizergthree,
    ImageResizergthree,
    KSamplerConfigrgthree,
    LoraLoaderStackrgthree,
    PowerLoraLoaderrgthree,
    PowerPrimitivergthree,
    PowerPromptrgthree,
    PowerPromptSimplergthree,
    PowerPuttergthree,
    SDXLEmptyLatentImagergthree,
    SDXLPowerPromptPositivergthree,
    SDXLPowerPromptSimplenegativethree,
    Seedrgthree,
};

// Power Lora Loader helpers (value guards + constants for the dedicated editors)
export {
    POWER_LORA_LOADER_NODE_TYPE,
    POWER_LORA_LOADER_SEPARATE_STRENGTHS,
    isPowerLoraEntry,
    isPowerLoraHeader,
} from './PowerLoraLoaderrgthree';
export type { PowerLoraEntry } from './PowerLoraLoaderrgthree';
