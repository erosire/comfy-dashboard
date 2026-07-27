// =============================================================================
// ComfyUI Node Registry — Shared Types & Enum Constants
// =============================================================================
//
// Core types shared by all node definition files in this registry.
// Import from this file when creating or consuming node definitions.
// =============================================================================

// ── Widget Value Types ───────────────────────────────────────────────────────

/**
 * Widget type identifiers used in ComfyUI node definitions.
 * Maps to both the Python type string and the frontend widget constructor.
 */
export type ComfyWidgetType =
    | 'INT'
    | 'FLOAT'
    | 'STRING'
    | 'BOOLEAN'
    | 'COMBO'
    | 'IMAGEUPLOAD'
    | 'FILEUPLOAD'
    | 'COLOR'
    | 'MARKDOWN'
    | string;

/**
 * Display mode for numeric widgets (INT/FLOAT).
 */
export type NumberDisplayMode = 'number' | 'slider' | 'knob';

// ── Widget Definition ────────────────────────────────────────────────────────

/**
 * A single widget definition for a node type.
 * Describes what a widget IS (type, name, constraints) and how it
 * should be DISPLAYED (label, placeholder, display mode).
 */
export interface WidgetDef {
    /** Internal widget name — matches the Python parameter name. */
    name: string;
    /** Human-readable label shown in the UI (replaces "#N"). */
    label: string;
    /** Widget type: INT, FLOAT, STRING, BOOLEAN, COMBO, etc. */
    widgetType: ComfyWidgetType;
    /** For COMBO widgets: the list of selectable options. */
    options?: string[];
    /** Default value if not provided in widgets_values. */
    default?: unknown;
    /** Minimum value for INT/FLOAT widgets. */
    min?: number;
    /** Maximum value for INT/FLOAT widgets. */
    max?: number;
    /** Step increment for INT/FLOAT widgets. */
    step?: number;
    /** Rounding precision for FLOAT widgets. */
    round?: number | false;
    /** Display mode for numeric widgets. */
    display?: NumberDisplayMode;
    /** For STRING widgets: whether to use a multi-line textarea. */
    multiline?: boolean;
    /** For STRING widgets: placeholder text when empty. */
    placeholder?: string;
    /** Whether this widget is optional (may be omitted). */
    optional?: boolean;
    /** Whether this widget has a linked companion widget. */
    linkedTo?: string;
    /** Tooltip text shown on hover. */
    tooltip?: string;
    /** If true, the widget is force-input only (no UI control). */
    forceInput?: boolean;
    /** If true, the widget is hidden from the UI. */
    hidden?: boolean;
    /** If true, the widget is in the advanced section. */
    advanced?: boolean;
    /** For IMAGEUPLOAD widgets: which folder to browse. */
    imageFolder?: string;
    /** For STRING widgets: enable dynamic prompt wildcard expansion. */
    dynamicPrompts?: boolean;
}

// ── Node Widget Layout ───────────────────────────────────────────────────────

/**
 * Widget layout for a node type — an ordered list of widget definitions.
 * The order matches the `widgets_values` array order.
 */
export interface NodeWidgetLayout {
    /** Node type name (class_type from Python). */
    nodeType: string;
    /** Display name shown on the node header. */
    displayName: string;
    /** Category path (e.g. "latent", "sampling", "loaders"). */
    category: string;
    /** Ordered widget definitions — index N maps to widgets_values[N]. */
    widgets: WidgetDef[];
}

// ── Enum Constants ───────────────────────────────────────────────────────────

/** Available sampler algorithms. Source: comfy/samplers.py */
export const SAMPLER_NAMES = [
    'euler',
    'euler_ancestral',
    'heun',
    'heunpp2',
    'dpm_2',
    'dpm_2_ancestral',
    'lms',
    'dpm_fast',
    'dpm_adaptive',
    'dpmpp_2s_ancestral',
    'dpmpp_sde',
    'dpmpp_sde_gpu',
    'dpmpp_2m',
    'dpmpp_2m_sde',
    'dpmpp_2m_sde_gpu',
    'dpmpp_3m_sde',
    'dpmpp_3m_sde_gpu',
    'ddpm',
    'lcm',
    'uni_pc',
    'uni_pc_bh2',
] as const;

/** Available scheduler types. Source: comfy/samplers.py */
export const SCHEDULER_NAMES = [
    'normal',
    'karras',
    'exponential',
    'sgm_uniform',
    'simple',
    'ddim_uniform',
    'beta',
    'linear_quadratic',
] as const;

/** Available upscale methods for image scaling nodes. */
export const UPSCALE_METHODS = [
    'nearest-exact',
    'bilinear',
    'area',
    'bicubic',
    'lanczos',
] as const;

/** Available crop modes for image scaling nodes. */
export const CROP_MODES = [
    'disabled',
    'center',
    'padding',
] as const;
