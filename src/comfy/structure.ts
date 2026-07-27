// =============================================================================
// ComfyUI Workflow & Node Structure
// =============================================================================
//
// This file documents the two primary JSON formats used by ComfyUI:
//
// 1. **Workflow format** — the visual graph saved by the UI (LiteGraph).
//    Contains layout, widget values, and link tuples/objects.
//    Key file: "Save (API Format)" exports prompt format; normal Save exports this.
//
// 2. **API prompt format** — flat dict sent to POST /prompt for execution.
//    Only contains class_type, input values (scalars), and link references.
//    No layout, no widget ordering, no visual metadata.
//
// Key relationships:
//   - `widgets_values` (workflow) → flat array of widget values, ordered by
//     the node type's INPUT_TYPES() definition. NOT the same as `inputs`.
//   - `inputs` (workflow) → connection slots (where wires connect).
//   - `inputs` (API prompt) → merged dict of widget values + link references.
//
// Sources:
//   - ComfyUI frontend: workflowSchema.ts, apiSchema.ts, nodeDefSchema.ts
//   - ComfyUI backend: comfy/graph.py, execution.py
//   - LiteGraph: LGraph.serialize(), LGraphNode.serialize()
// =============================================================================

// ── Primitives ──────────────────────────────────────────────────────────────

/** Node ID — numeric in most cases, but can be string for group nodes. */
export type NodeId = number | string;

/** Slot index — zero-based position of an input or output on a node. */
export type SlotIndex = number | string; // strings are parsed to int

/**
 * Data type for links and slots.
 * Common values: "MODEL", "CLIP", "VAE", "CONDITIONING", "LATENT",
 *                "IMAGE", "MASK", "STRING", "INT", "FLOAT", "BOOLEAN"
 * Custom nodes can add arbitrary types (e.g. "UPSCALE_MODEL", "CONTROL_NET").
 * "*" is a wildcard that accepts any type.
 */
export type DataType = string | string[] | number;

/** 2D position or size vector [x, y] or [width, height]. */
export type Vector2 = [number, number];

// ── Link Formats ────────────────────────────────────────────────────────────
//
// Links represent connections between node output slots and input slots.
// There are two formats depending on the workflow version.

/**
 * v0.4 (legacy) link format — a 6-element tuple:
 *   [linkId, sourceNodeId, sourceSlot, targetNodeId, targetSlot, dataType]
 *
 * Used in `WorkflowJSON04.links`.
 */
export type ComfyLinkTuple = [
    number,    // link id — unique link identifier
    NodeId,    // source node id — the node producing output
    SlotIndex, // source slot index — which output slot on the source node
    NodeId,    // target node id — the node receiving input
    SlotIndex, // target slot index — which input slot on the target node
    DataType,  // data type — e.g. "IMAGE", "MODEL"
];

/**
 * v1 link format — an object with named fields.
 * Used in `WorkflowJSON.links`.
 */
export interface ComfyLink {
    id: number;            // unique link identifier
    origin_id: NodeId;     // source node id
    origin_slot: SlotIndex; // source output slot index
    target_id: NodeId;     // target node id
    target_slot: SlotIndex; // target input slot index
    type: DataType;        // data type string
    parentId?: number;     // parent reroute id (if link goes through a reroute)
}

// ── Node Input/Output Slots ─────────────────────────────────────────────────
//
// Each node has `inputs` (left side, receives data) and `outputs` (right side, sends data).
// These are the visual connection points on the node.

/**
 * A single input slot on a node (left side).
 * Appears in the `inputs` array of a workflow node.
 *
 * - `link` holds a single link ID if connected, null otherwise.
 * - `shape` determines the visual appearance (see RenderShape).
 * - Optional inputs (shape: 1) may or may not be present.
 * - Hidden inputs (shape: 7) are not visible and have no widget.
 * - Converted-to-input widgets (shape: 6) were originally widgets.
 */
export interface NodeInput {
    name: string;           // input slot name (e.g. "image", "model", "mask")
    type: DataType;         // data type (e.g. "IMAGE", "MODEL", "*")
    link?: number | null;   // link ID connected to this input, null if unconnected
    shape?: number;         // visual shape (see RenderShape enum)
    slot_index?: SlotIndex; // explicit slot index (usually matches array position)
    localized_name?: string; // display name (removed before API submission)
    [key: string]: unknown;  // custom nodes may add extra fields
}

/**
 * A single output slot on a node (right side).
 * Appears in the `outputs` array of a workflow node.
 *
 * - `links` holds an array of link IDs connected to this output.
 *   A single output can feed into multiple inputs (fan-out).
 */
export interface NodeOutput {
    name: string;            // output slot name (e.g. "MODEL", "IMAGE")
    type: DataType;          // data type
    links?: number[] | null; // link IDs connected to this output
    slot_index?: SlotIndex;  // explicit slot index
    type_is_list?: boolean;  // if true, output is a list of items
    localized_name?: string;
    [key: string]: unknown;
}

// ── Slot Shape Enum ─────────────────────────────────────────────────────────
//
// The `shape` field on NodeInput determines the visual style of the slot.
// This is a LiteGraph concept.

export enum RenderShape {
    BOX = 1,          // Rectangle — default for most inputs
    ROUND = 2,        // Rounded rectangle
    CIRCLE = 3,       // Circle
    CARD = 4,         // Two rounded corners (top-left & bottom-right)
    ARROW = 5,        // Arrow — used for some link indicators
    GRID = 6,         // Grid pattern — used for converted widget inputs
    HOLLOW_CIRCLE = 7, // Hollow circle — hidden/internal inputs (no widget)
}

// ── Node Flags ──────────────────────────────────────────────────────────────

export interface NodeFlags {
    collapsed?: boolean;      // node is collapsed to title-only view
    pinned?: boolean;         // node cannot be moved
    allow_interaction?: boolean; // node accepts user interaction
    horizontal?: boolean;     // node renders horizontally
    skip_repeated_outputs?: boolean; // skip duplicate output connections
    [key: string]: unknown;
}

// ── Node Properties ─────────────────────────────────────────────────────────
//
// Metadata about the node, stored in `properties`.
// Most important: "Node name for S&R" is used by Search & Replace workflows.

export interface NodeProperties {
    /** Name used by Search & Replace workflow automation. */
    'Node name for S&R'?: string;
    /** Comfy Node Registry package ID (e.g. "comfyui-facedetailer"). */
    cnr_id?: string;
    /** GitHub-style ID for non-CNR packs (e.g. "user/repo"). */
    aux_id?: string;
    /** Version string (semver, git hash, or "unknown"). */
    ver?: string;
    /** Required model files for this node. */
    models?: ModelFile[];
    [key: string]: unknown;
}

// ── Model File ──────────────────────────────────────────────────────────────

export interface ModelFile {
    name: string;
    url: string;
    hash?: string;
    hash_type?: string;
    directory: string; // subfolder under models/ (e.g. "checkpoints", "vae")
}

// ── Node Event Mode ─────────────────────────────────────────────────────────
//
// The `mode` field determines when/how the node executes.

export enum LGraphEventMode {
    /** Node always executes as part of the workflow. */
    ALWAYS = 0,
    /** Node executes only when triggered by an event. */
    ON_EVENT = 1,
    /** Node is disabled — never executes. Shows as muted/greyed out. */
    NEVER = 2,
    /** Node executes when explicitly triggered. */
    ON_TRIGGER = 3,
    /** Node is bypassed — inputs pass directly to outputs unchanged. */
    BYPASS = 4,
}

// ── Workflow Node ───────────────────────────────────────────────────────────
//
// This is the full node object as stored in a workflow JSON's `nodes` array.
// It contains both the logical data (inputs, outputs, widget values) and
// visual data (position, size, colors, flags).

export interface WorkflowNode {
    /** Unique node identifier within the workflow. */
    id: NodeId;
    /** Node type/class name (e.g. "KSampler", "CheckpointLoaderSimple"). */
    type: string;
    /** Canvas position [x, y] in pixels. */
    pos: Vector2;
    /** Display size [width, height] in pixels. */
    size: Vector2;
    /** Visual/behavioral flags. */
    flags: NodeFlags;
    /** Execution order — lower values execute first. Set by the scheduler. */
    order: number;
    /** Execution mode — 0=Always, 2=Never, 4=Bypass. See LGraphEventMode. */
    mode: number;
    /** Input slots (left side) — connection points that receive data. */
    inputs?: NodeInput[];
    /** Output slots (right side) — connection points that send data. */
    outputs?: NodeOutput[];
    /** Node metadata (S&R name, CNR id, version, required models). */
    properties: NodeProperties;
    /**
     * Widget values — serialized state of all UI controls on the node.
     *
     * **Array form** (most common): values are ordered by the node type's
     * INPUT_TYPES() definition. This order matches the visual top-to-bottom
     * layout of widgets on the node.
     *
     * **Record form**: keyed by widget name (newer format).
     *
     * Values can be: string, number, boolean, or complex objects.
     * These correspond to sliders, dropdowns, text fields, etc.
     *
     * IMPORTANT: `widgets_values` is INDEPENDENT from `inputs`.
     * `inputs` has connection slots; `widgets_values` has UI control values.
     * They do NOT map1:1.
     */
    widgets_values?: unknown[] | Record<string, unknown>;
    /** CSS color for node header (e.g. "#2a363b"). */
    color?: string;
    /** CSS color for node body background. */
    bgcolor?: string;
    [key: string]: unknown; // custom nodes may add extra fields
}

// ── Reroute Nodes ───────────────────────────────────────────────────────────
//
// Reroute nodes are visual helpers that redirect link paths.
// They don't process data — just change where the wire goes on screen.

export interface Reroute {
    id: number;
    parentId?: number; // parent reroute for chained reroutes
    pos: Vector2;
    linkIds?: number[] | null;
    floating?: {
        slotType: 'input' | 'output';
    };
    [key: string]: unknown;
}

// ── Groups ──────────────────────────────────────────────────────────────────
//
// Visual grouping of nodes on the canvas. Does not affect execution.

export interface Group {
    id?: number;
    title: string;
    /** Bounding box [x, y, width, height]. */
    bounding: [number, number, number, number];
    color?: string;
    font_size?: number;
    locked?: boolean;
    [key: string]: unknown;
}

// ── Workflow Extra / State ──────────────────────────────────────────────────
//
// `extra` holds display state, frontend version, reroutes, etc.

export interface DisplayState {
    /** Current zoom level. */
    scale: number;
    /** Canvas pan offset [x, y]. */
    offset: Vector2;
    [key: string]: unknown;
}

export interface WorkflowExtra {
    /** Canvas display state (zoom, pan). */
    ds?: DisplayState;
    /** Frontend version that last saved this workflow. */
    frontendVersion?: string;
    /** v0.4 link extensions for rerouted links. */
    linkExtensions?: ComfyLink[];
    /** Reroute node definitions. */
    reroutes?: Reroute[];
    /** Workflow renderer version ("LG" | "Vue" | "Vue-corrected"). */
    workflowRendererVersion?: string;
    [key: string]: unknown;
}

export interface WorkflowConfig {
    links_ontop?: boolean;
    align_to_grid?: boolean;
    [key: string]: unknown;
}

// ── Workflow JSON ───────────────────────────────────────────────────────────
//
// The complete workflow file format. There are two versions:

/**
 * v0.4 workflow format (legacy).
 * Links are stored as tuples in `links`.
 */
export interface WorkflowJSON04 {
    id?: string;
    revision?: number;
    last_node_id: NodeId;
    last_link_id: number;
    nodes: WorkflowNode[];
    /** Links as tuple arrays: [linkId, srcNode, srcSlot, tgtNode, tgtSlot, dataType] */
    links: ComfyLinkTuple[];
    floatingLinks?: ComfyLink[];
    groups?: Group[];
    config?: WorkflowConfig | null;
    extra?: WorkflowExtra | null;
    version: number; // 0.4
    models?: ModelFile[];
}

/**
 * v1 workflow format (current).
 * Links are stored as objects in `links`.
 */
export interface WorkflowJSON {
    id?: string;
    revision?: number;
    version: number; // 1
    state?: {
        lastGroupId?: number;
        lastNodeId?: number;
        lastLinkId?: number;
        lastRerouteId?: number;
    };
    nodes: WorkflowNode[];
    /** Links as objects with named fields. */
    links?: ComfyLink[];
    floatingLinks?: ComfyLink[];
    reroutes?: Reroute[];
    groups?: Group[];
    config?: WorkflowConfig | null;
    extra?: WorkflowExtra | null;
    models?: ModelFile[];
}

// ── API Prompt Format ───────────────────────────────────────────────────────
//
// This is the format sent to POST /prompt for backend execution.
// It is a flat dictionary keyed by node ID (as string).
//
// Each node entry has:
//   - `inputs`: merged dict of widget values (scalars) AND link references
//   - `class_type`: the node type (same as workflow `type`)
//   - `_meta`: display metadata (title only)
//
// Link references in inputs use the format: ["sourceNodeId", sourceSlotIndex]
// Widget values are stored as their literal values (string, number, boolean).
//
// Example:
// {
//   "1": {
//     "inputs": { "image": "photo.png" },
//     "class_type": "LoadImage",
//     "_meta": { "title": "Load Image" }
//   },
//   "2": {
//     "inputs": { "image": ["1", 0], "upscale_method": "lanczos" },
//     "class_type": "ImageScale",
//     "_meta": { "title": "Image Scale" }
//   }
// }

export interface ApiPromptNode {
    /**
     * Merged inputs: widget values (scalars) and link references.
     * Link reference format: [nodeId (string), slotIndex (number)]
     * Widget values: string, number, boolean, or object.
     */
    inputs: Record<string, unknown>;
    /** Node class type (e.g. "KSampler", "CheckpointLoaderSimple"). */
    class_type: string;
    /** Display metadata — only `title` is used. */
    _meta: {
        title: string;
    };
}

/** The complete API prompt — keyed by node ID string. */
export type ApiPrompt = Record<string, ApiPromptNode>;

// ── Node Definition (from /object_info) ─────────────────────────────────────
//
// Node definitions describe what a node type CAN do — its inputs, outputs,
// and metadata. Fetched from GET /object_info or /object_info/{nodeClass}.
// This is NOT stored in the workflow; it's queried from the running backend.

/**
 * Input specification for a single slot/widget on a node type.
 * Returned by INPUT_TYPES() in the Python node class.
 */
export interface InputSpec {
    type: string;          // widget type: "INT", "FLOAT", "STRING", "COMBO", "BOOLEAN", etc.
    name: string;          // input name (display name)
    isOptional?: boolean;  // if true, input can be omitted
    min?: number;          // for INT/FLOAT: minimum value
    max?: number;          // for INT/FLOAT: maximum value
    step?: number;         // for INT/FLOAT: step increment
    default?: unknown;     // default value
    multiline?: boolean;   // for STRING: multi-line textarea
    placeholder?: string;  // for STRING: placeholder text
    options?: Record<string, unknown>; // type-specific options
    [key: string]: unknown;
}

/**
 * Output specification for a single output slot on a node type.
 */
export interface OutputSpec {
    index: number;
    name: string;
    type: string;       // data type (e.g. "IMAGE", "MODEL", "CONDITIONING")
    is_list: boolean;   // if true, output is a list of items
    tooltip?: string;
}

/**
 * Full node type definition returned from GET /object_info.
 * Describes everything about a node type — its inputs, outputs,
 * category, and whether it's an output/save node.
 */
export interface ComfyNodeDef {
    /** Node type name (internal, same as `type` in workflow nodes). */
    name: string;
    /** Display name shown in the UI. */
    display_name: string;
    /** Human-readable description. */
    description: string;
    /** Category path (e.g. "sampling/loaders", "image/transform"). */
    category: string;
    /**
     * Input specifications — split into required and optional.
     * Keys are input group names; values are dicts of input specs.
     */
    inputs: Record<string, Record<string, InputSpec>>;
    /** Output slot definitions. */
    outputs: OutputSpec[];
    /** Whether this node produces final output (SaveImage, PreviewImage, etc.). */
    output_node: boolean;
    /** Python module path (usually "nodes" or custom node package name). */
    python_module: string;
    /** Whether the node is deprecated. */
    deprecated?: boolean;
    /** Whether the node is experimental. */
    experimental?: boolean;
    /** Whether the node is dev-only. */
    dev_only?: boolean;
    /** Whether the node is API-only (no UI). */
    api_node?: boolean;
    /** Hidden/internal state keys. */
    hidden?: Record<string, unknown>;
    /** Search aliases for finding this node. */
    search_aliases?: string[];
}

// ── Widget Types ────────────────────────────────────────────────────────────
//
// These are the widget type strings used in node definitions and rendering.

export type WidgetType =
    | 'toggle'         // Boolean on/off switch
    | 'number'         // Numeric input field
    | 'slider'         // Slider with min/max
    | 'gradientslider' // Gradient-colored slider
    | 'knob'           // Rotary knob control
    | 'combo'          // Dropdown/select (from a list of values)
    | 'string'         // Single-line text input
    | 'text'           // Alias for string
    | 'button'         // Click button (no persisted value)
    | 'custom'         // Custom widget (registered by extensions)
    | 'fileupload'     // File upload widget
    | 'color'          // Color picker
    | 'markdown'       // Markdown display
    | 'image'          // Image display/selector
    | 'textarea'       // Multi-line text input
    | 'range'          // Dual-handle range slider
    | 'curve'          // Curve editor (bezier/monotone cubic)
    | 'painter'        // Painting/annotation tool
    | string;          // custom widgets can register any string

// ── Common Data Type Strings ────────────────────────────────────────────────
//
// These are the standard DataType values used across ComfyUI.
// Custom nodes can define additional types.

export const COMMON_DATA_TYPES = {
    MODEL: 'MODEL',                   // Diffusion model (SD1.5, SDXL, Flux, etc.)
    CLIP: 'CLIP',                     // Text encoder (CLIPTextEncode output)
    VAE: 'VAE',                       // Variational Autoencoder
    CONDITIONING: 'CONDITIONING',     // Positive/negative conditioning pair
    LATENT: 'LATENT',                 // Latent space tensor
    IMAGE: 'IMAGE',                   // Pixel-space image (batch of tensors)
    MASK: 'MASK',                     // Binary/alpha mask
    STRING: 'STRING',                 // Text string
    INT: 'INT',                       // Integer number
    FLOAT: 'FLOAT',                   // Floating-point number
    BOOLEAN: 'BOOLEAN',               // True/false
} as const;

// ── Utility: Link Reference Check ───────────────────────────────────────────
//
// In the API prompt format, a value in `inputs` is a link reference if it's
// a 2-element array: [nodeId (string), slotIndex (number)].

/**
 * Check if a value in an API prompt `inputs` dict is a link reference.
 * Link refs are [string, number] tuples pointing to a source node's output.
 */
export function isApiLinkRef(val: unknown): val is [string, number] {
    return (
        Array.isArray(val) &&
        val.length === 2 &&
        typeof val[0] === 'string' &&
        typeof val[1] === 'number'
    );
}
