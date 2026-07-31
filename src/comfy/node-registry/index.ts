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

// ── Core ComfyUI nodes ──────────────────────────────────────────────────────
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
import { LTXVConditioning } from './LTXVConditioning';

import { MaskToImage } from './MaskToImage';
import { ImageToMask } from './ImageToMask';

import { ModelSamplingFlux } from './ModelSamplingFlux';

// Custom sampling / noise / sigmas / guiders
import { RandomNoise } from './RandomNoise';
import { KSamplerSelect } from './KSamplerSelect';
import { ManualSigmas } from './ManualSigmas';
import { CFGGuider } from './CFGGuider';
import { SamplerCustomAdvanced } from './SamplerCustomAdvanced';

// Math
import { ComfyMathExpression } from './ComfyMathExpression';

// LTXV nodes
import { LTXVPreprocess } from './LTXVPreprocess';
import { LTXVEmptyLatentAudio } from './LTXVEmptyLatentAudio';
import { EmptyLTXVLatentVideo } from './EmptyLTXVLatentVideo';
import { LTXVConcatAVLatent } from './LTXVConcatAVLatent';
import { LTXVSeparateAVLatent } from './LTXVSeparateAVLatent';
import { LTXVLatentUpsampler } from './LTXVLatentUpsampler';
import { LTXVAudioVAEDecode } from './LTXVAudioVAEDecode';
import { LTXVAudioVAELoader } from './LTXVAudioVAELoader';
import { LTXAVTextEncoderLoader } from './LTXAVTextEncoderLoader';
import { LatentUpscaleModelLoader } from './LatentUpscaleModelLoader';

// Image batch
import { ImageFromBatch } from './ImageFromBatch';

// Built-in ComfyUI nodes (additional)
import { ConditioningZeroOut } from './ConditioningZeroOut';
import { ReferenceLatent } from './ReferenceLatent';
import { GetImageSize } from './GetImageSize';

// Built-in ComfyUI primitives & text nodes
import { PrimitiveBoolean } from './PrimitiveBoolean';
import { PrimitiveFloat } from './PrimitiveFloat';
import { PrimitiveStringMultiline } from './PrimitiveStringMultiline';
import { StringConcatenate } from './StringConcatenate';
import { LoraLoaderModelOnly } from './LoraLoaderModelOnly';
import { ComfySwitchNode } from './ComfySwitchNode';
import { PreviewAny } from './PreviewAny';
import { TextGenerate } from './TextGenerate';
import { ResolutionSelector } from './ResolutionSelector';

// ── Custom node pack imports ────────────────────────────────────────────────

// ComfyUI-VideoHelperSuite
import { vhsNodes } from './ComfyUI-VideoHelperSuite';

// ComfyUI-KJNodes
import { ComfyUIKJNodes } from './ComfyUI-KJNodes';

// rgthree-comfy
import { rgthreeNodes } from './rgthree-comfy';

// RES4LYF
import {
    ClownsharKSampler_Beta,
    TextBox1,
} from './RES4LYF';
import { res4lyfNodes } from './RES4LYF';

// ComfyUI-GGUF
import { ggufNodes } from './ComfyUI-GGUF';

// ComfyUI-CloudClient
import { cloudClientNodes } from './ComfyUI-CloudClient';

// 10S-Comfy-nodes
import { tensNodes } from './10S-Comfy-nodes';

// comfyui-krea2edit
import { krea2editNodes } from './comfyui-krea2edit';

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
    // ── Core ComfyUI nodes ──────────────────────────────────────────────────

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
    LTXVConditioning,

    // Mask
    MaskToImage,
    ImageToMask,

    // Model / Flux
    ModelSamplingFlux,

    // Custom sampling / noise / sigmas / guiders
    RandomNoise,
    KSamplerSelect,
    ManualSigmas,
    CFGGuider,
    SamplerCustomAdvanced,

    // Math
    ComfyMathExpression,

    // LTXV nodes
    LTXVPreprocess,
    LTXVEmptyLatentAudio,
    EmptyLTXVLatentVideo,
    LTXVConcatAVLatent,
    LTXVSeparateAVLatent,
    LTXVLatentUpsampler,
    LTXVAudioVAEDecode,
    LTXVAudioVAELoader,
    LTXAVTextEncoderLoader,
    LatentUpscaleModelLoader,

    // Image batch
    ImageFromBatch,

    // Additional built-in ComfyUI nodes
    ConditioningZeroOut,
    ReferenceLatent,
    GetImageSize,

    // Built-in ComfyUI primitives & text nodes
    PrimitiveBoolean,
    PrimitiveFloat,
    PrimitiveStringMultiline,
    StringConcatenate,
    LoraLoaderModelOnly,
    ComfySwitchNode,
    PreviewAny,
    TextGenerate,
    ResolutionSelector,

    // ── Third-party / Custom node packs ─────────────────────────────────────

    // RES4LYF (direct imports for nodes used by other code)
    ClownsharKSampler_Beta,
    TextBox1,

    // Spread all custom node pack registries
    ...vhsNodes,
    ...ComfyUIKJNodes,
    ...rgthreeNodes,
    ...res4lyfNodes,
    ...ggufNodes,
    ...cloudClientNodes,
    ...tensNodes,
    ...krea2editNodes,
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
