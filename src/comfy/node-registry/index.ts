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
} from './types';

export {
    SAMPLER_NAMES,
    SCHEDULER_NAMES,
    UPSCALE_METHODS,
    CROP_MODES,
} from './types';

// ── Import all node definitions ──────────────────────────────────────────────

// Latent nodes
export { EmptyLatentImage } from './EmptyLatentImage';
export { EmptyFlux2LatentImage } from './EmptyFlux2LatentImage';
export { EmptySD3LatentImage } from './EmptySD3LatentImage';
export { EmptyLatentAudio } from './EmptyLatentAudio';

// Sampling nodes
export { KSampler } from './KSampler';
export { KSamplerAdvanced } from './KSamplerAdvanced';
export { SamplerCustom } from './SamplerCustom';

// Loader nodes
export { CheckpointLoaderSimple } from './CheckpointLoaderSimple';
export { CheckpointLoader } from './CheckpointLoader';
export { UNETLoader } from './UNETLoader';
export { DualCLIPLoader } from './DualCLIPLoader';
export { CLIPLoader } from './CLIPLoader';
export { VAELoader } from './VAELoader';
export { LoraLoader } from './LoraLoader';
export { LoadImage } from './LoadImage';

// Conditioning nodes
export { CLIPTextEncode } from './CLIPTextEncode';
export { CLIPTextEncodeSDXL } from './CLIPTextEncodeSDXL';
export { CLIPTextEncodeFlux } from './CLIPTextEncodeFlux';

// VAE nodes
export { VAEDecode } from './VAEDecode';
export { VAEEncode } from './VAEEncode';
export { VAEDecodeTiled } from './VAEDecodeTiled';
export { VAEEncodeTiled } from './VAEEncodeTiled';

// Image nodes
export { ImageScale } from './ImageScale';
export { ImageScaleBy } from './ImageScaleBy';
export { ImageInvert } from './ImageInvert';
export { ImageBatch } from './ImageBatch';
export { ImageResize } from './ImageResize';

// Save / Preview nodes
export { SaveImage } from './SaveImage';
export { PreviewImage } from './PreviewImage';

// Latent operations
export { LatentUpscale } from './LatentUpscale';
export { LatentComposite } from './LatentComposite';
export { SetLatentNoiseMask } from './SetLatentNoiseMask';

// Conditioning operations
export { ConditioningCombine } from './ConditioningCombine';
export { ConditioningSetTimestepRange } from './ConditioningSetTimestepRange';

// Mask nodes
export { MaskToImage } from './MaskToImage';
export { ImageToMask } from './ImageToMask';

// Model / Flux nodes
export { ModelSamplingFlux } from './ModelSamplingFlux';

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
