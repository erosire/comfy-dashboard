// =============================================================================
// ComfyUI Node Registry — Barrel Export
// =============================================================================
//
// Import from this file to access all registered node definitions:
//
//   import { comfyNodeRegistry, getWidgetLabel } from './node-registry';
//
//   // Look up a specific node — returns NodeWidgetLayout
//   comfyNodeRegistry["LoraLoader"];  // { nodeType, displayName, category, widgets }
//   comfyNodeRegistry["KSampler"];    // { ... }
//
//   // Get a widget label
//   const label = getWidgetLabel('KSampler', 0); // "Seed"
//
// =============================================================================

// ── Re-export shared types and constants ─────────────────────────────────────
export type {
    ComfyWidgetType,
    NumberDisplayMode,
    WidgetDef,
    NodeWidgetLayout,
    GitHubSource,
} from './types';

export {
    SAMPLER_NAMES,
    SCHEDULER_NAMES,
    UPSCALE_METHODS,
    CROP_MODES,
} from './types';

// ── comfyNodeRegistry ────────────────────────────────────────────────────────
//
// The primary export: a Record keyed by node type (class_type).
// Direct O(1) lookup by node type string.

import type { NodeWidgetLayout } from './types';

import { EmptyLatentImage } from './EmptyLatentImage';
import { EmptyFlux2LatentImage } from './EmptyFlux2LatentImage';
import { EmptySD3LatentImage } from './EmptySD3LatentImage';
import { EmptyLatentAudio } from './EmptyLatentAudio';

import { KSampler } from './KSampler';
import { KSamplerAdvanced } from './KSamplerAdvanced';
import { SamplerCustom } from './SamplerCustom';

import { CheckpointLoaderSimple } from './CheckpointLoaderSimple';
import { CheckpointLoader } from './CheckpointLoader';
import { UNETLoader } from './UNETLoader';
import { DualCLIPLoader } from './DualCLIPLoader';
import { CLIPLoader } from './CLIPLoader';
import { VAELoader } from './VAELoader';
import { LoraLoader } from './LoraLoader';
import { LoadImage } from './LoadImage';

import { CLIPTextEncode } from './CLIPTextEncode';
import { CLIPTextEncodeSDXL } from './CLIPTextEncodeSDXL';
import { CLIPTextEncodeFlux } from './CLIPTextEncodeFlux';

import { VAEDecode } from './VAEDecode';
import { VAEEncode } from './VAEEncode';
import { VAEDecodeTiled } from './VAEDecodeTiled';
import { VAEEncodeTiled } from './VAEEncodeTiled';

import { ImageScale } from './ImageScale';
import { ImageScaleBy } from './ImageScaleBy';
import { ImageInvert } from './ImageInvert';
import { ImageBatch } from './ImageBatch';
import { ImageResize } from './ImageResize';

import { SaveImage } from './SaveImage';
import { PreviewImage } from './PreviewImage';

import { LatentUpscale } from './LatentUpscale';
import { LatentComposite } from './LatentComposite';
import { SetLatentNoiseMask } from './SetLatentNoiseMask';

import { ConditioningCombine } from './ConditioningCombine';
import { ConditioningSetTimestepRange } from './ConditioningSetTimestepRange';

import { MaskToImage } from './MaskToImage';
import { ImageToMask } from './ImageToMask';

import { ModelSamplingFlux } from './ModelSamplingFlux';

import { ClownsharKSampler_Beta } from './ClownsharKSampler_Beta';

// Built-in ComfyUI nodes (additional)
import { ConditioningZeroOut } from './ConditioningZeroOut';
import { ReferenceLatent } from './ReferenceLatent';
import { GetImageSize } from './GetImageSize';

// Built-in ComfyUI primitives & text nodes
import { PrimitiveBoolean } from './PrimitiveBoolean';
import { PrimitiveStringMultiline } from './PrimitiveStringMultiline';
import { StringConcatenate } from './StringConcatenate';
import { LoraLoaderModelOnly } from './LoraLoaderModelOnly';
import { ComfySwitchNode } from './ComfySwitchNode';
import { PreviewAny } from './PreviewAny';
import { TextGenerate } from './TextGenerate';

// Custom node packs
import { TextBox1 } from './TextBox1';

// KJNodes
import { ImageResizeKJv2 } from './ImageResizeKJv2';

// rgthree-comfy
import { PowerLoraLoaderrgthree } from './PowerLoraLoaderrgthree';
import { Seedrgthree } from './Seedrgthree';
import { Contextrgthree } from './Contextrgthree';
import { ContextBigrgthree } from './ContextBigrgthree';
import { ContextSwitchrgthree } from './ContextSwitchrgthree';
import { ContextSwitchBigrgthree } from './ContextSwitchBigrgthree';
import { ContextMergergthree } from './ContextMergergthree';
import { ContextMergeBigrgthree } from './ContextMergeBigrgthree';
import { DisplayIntrgthree } from './DisplayIntrgthree';
import { DisplayAnyrgthree } from './DisplayAnyrgthree';
import { LoraLoaderStackrgthree } from './LoraLoaderStackrgthree';
import { ImageInsetCropprgthree } from './ImageInsetCropprgthree';
import { PowerPromptrgthree } from './PowerPromptrgthree';
import { PowerPromptSimplergthree } from './PowerPromptSimplergthree';
import { KSamplerConfigrgthree } from './KSamplerConfigrgthree';
import { SDXLEmptyLatentImagergthree } from './SDXLEmptyLatentImagergthree';
import { SDXLPowerPromptPositivergthree } from './SDXLPowerPromptPositivergthree';
import { SDXLPowerPromptSimplenegativethree } from './SDXLPowerPromptSimplenegativethree';
import { AnySwitchrgthree } from './AnySwitchrgthree';
import { ImageComparerrgthree } from './ImageComparerrgthree';
import { PowerPrimitivergthree } from './PowerPrimitivergthree';
import { ImageOrLatentSizergthree } from './ImageOrLatentSizergthree';
import { ImageResizergthree } from './ImageResizergthree';
import { PowerPuttergthree } from './PowerPuttergthree';
import { FastGroupsMuterthree } from './FastGroupsMuterthree';

// ComfyUI-CloudClient
import { ClientImageDownloadNode } from './ClientImageDownloadNode';
import { ClientVideoDownloadNode } from './ClientVideoDownloadNode';
import { RemoteImageLoader } from './RemoteImageLoader';
import { ServerMemoryImageNode } from './ServerMemoryImageNode';
import { TemporaryImagePreviewCloudClient } from './TemporaryImagePreviewCloudClient';
import { UniversalDataToImage } from './UniversalDataToImage';
import { UniversalDataToAudioVideo } from './UniversalDataToAudioVideo';

/**
 * The primary node widget registry.
 *
 * Keyed by node type (class_type from Python). Each value contains the
 * node's display name, category, and ordered widget definitions that
 * map directly to `widgets_values` indices.
 *
 * Usage:
 *   import { comfyNodeRegistry } from './node-registry';
 *
 *   comfyNodeRegistry["KSampler"];
 *   // => { nodeType: "KSampler", displayName: "KSampler", widgets: [...], ... }
 *
 *   comfyNodeRegistry["LoraLoader"].widgets[1].label; // "Model Strength"
 */
export const comfyNodeRegistry: Record<string, NodeWidgetLayout> = {
    // Latent
    EmptyLatentImage,
    EmptyFlux2LatentImage,
    EmptySD3LatentImage,
    EmptyLatentAudio,

    // Sampling
    KSampler,
    KSamplerAdvanced,
    SamplerCustom,

    // Loaders
    CheckpointLoaderSimple,
    CheckpointLoader,
    UNETLoader,
    DualCLIPLoader,
    CLIPLoader,
    VAELoader,
    LoraLoader,
    LoadImage,

    // Conditioning
    CLIPTextEncode,
    CLIPTextEncodeSDXL,
    CLIPTextEncodeFlux,

    // VAE
    VAEDecode,
    VAEEncode,
    VAEDecodeTiled,
    VAEEncodeTiled,

    // Image
    ImageScale,
    ImageScaleBy,
    ImageInvert,
    ImageBatch,
    ImageResize,

    // Save / Preview
    SaveImage,
    PreviewImage,

    // Latent operations
    LatentUpscale,
    LatentComposite,
    SetLatentNoiseMask,

    // Conditioning operations
    ConditioningCombine,
    ConditioningSetTimestepRange,

    // Mask
    MaskToImage,
    ImageToMask,

    // Model / Flux
    ModelSamplingFlux,

    // Third-party / Custom nodes
    ClownsharKSampler_Beta,

    // Additional built-in ComfyUI nodes
    ConditioningZeroOut,
    ReferenceLatent,
    GetImageSize,

    // Built-in ComfyUI primitives & text nodes
    PrimitiveBoolean,
    PrimitiveStringMultiline,
    StringConcatenate,
    LoraLoaderModelOnly,
    ComfySwitchNode,
    PreviewAny,
    TextGenerate,

    // Custom node packs
    TextBox1,

    // KJNodes (kijai)
    ImageResizeKJv2,

    // rgthree-comfy
    [PowerLoraLoaderrgthree.nodeType]: PowerLoraLoaderrgthree,
    [Seedrgthree.nodeType]: Seedrgthree,
    [Contextrgthree.nodeType]: Contextrgthree,
    [ContextBigrgthree.nodeType]: ContextBigrgthree,
    [ContextSwitchrgthree.nodeType]: ContextSwitchrgthree,
    [ContextSwitchBigrgthree.nodeType]: ContextSwitchBigrgthree,
    [ContextMergergthree.nodeType]: ContextMergergthree,
    [ContextMergeBigrgthree.nodeType]: ContextMergeBigrgthree,
    [DisplayIntrgthree.nodeType]: DisplayIntrgthree,
    [DisplayAnyrgthree.nodeType]: DisplayAnyrgthree,
    [LoraLoaderStackrgthree.nodeType]: LoraLoaderStackrgthree,
    [ImageInsetCropprgthree.nodeType]: ImageInsetCropprgthree,
    [PowerPromptrgthree.nodeType]: PowerPromptrgthree,
    [PowerPromptSimplergthree.nodeType]: PowerPromptSimplergthree,
    [KSamplerConfigrgthree.nodeType]: KSamplerConfigrgthree,
    [SDXLEmptyLatentImagergthree.nodeType]: SDXLEmptyLatentImagergthree,
    [SDXLPowerPromptPositivergthree.nodeType]: SDXLPowerPromptPositivergthree,
    [SDXLPowerPromptSimplenegativethree.nodeType]: SDXLPowerPromptSimplenegativethree,
    [AnySwitchrgthree.nodeType]: AnySwitchrgthree,
    [ImageComparerrgthree.nodeType]: ImageComparerrgthree,
    [PowerPrimitivergthree.nodeType]: PowerPrimitivergthree,
    [ImageOrLatentSizergthree.nodeType]: ImageOrLatentSizergthree,
    [ImageResizergthree.nodeType]: ImageResizergthree,
    [PowerPuttergthree.nodeType]: PowerPuttergthree,
    [FastGroupsMuterthree.nodeType]: FastGroupsMuterthree,

    // ComfyUI-CloudClient
    ClientImageDownloadNode,
    ClientVideoDownloadNode,
    RemoteImageLoader,
    ServerMemoryImageNode,
    [TemporaryImagePreviewCloudClient.nodeType]: TemporaryImagePreviewCloudClient,
    UniversalDataToImage,
    UniversalDataToAudioVideo,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the human-readable widget label for a given node type and index.
 * Falls back to "#N" if the node or widget is not registered.
 */
export function getWidgetLabel(
    nodeType: string,
    index: number,
    fallbackPrefix: string = '#',
): string {
    const layout = comfyNodeRegistry[nodeType];
    if (layout?.widgets[index]) {
        return layout.widgets[index].label;
    }
    return `${fallbackPrefix}${index + 1}`;
}

/**
 * Get all registered node type names.
 */
export function getRegisteredNodeTypes(): string[] {
    return Object.keys(comfyNodeRegistry);
}

/**
 * Check if a node type is registered in the library.
 */
export function isNodeRegistered(nodeType: string): boolean {
    return nodeType in comfyNodeRegistry;
}
