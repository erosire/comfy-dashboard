// =============================================================================
// Comfy Node Type — UI representation of a workflow node.
//
// Bridges the structure.ts canonical types with the dashboard UI.
// The `UINode` is a flattened, display-friendly view that the React
// components consume. It is produced by `parseWorkflowJson()` in
// features/workflow (components/utils) from either WorkflowJSON,
// WorkflowJSON04, or ApiPrompt.
// =============================================================================

import type {
    WorkflowNode,
    NodeProperties,
    NodeFlags,
    ApiPromptNode,
    DataType,
    SubgraphDefinition,
    ComfyLink,
    Group,
} from '../../comfy';

// ── UI Node (display-friendly representation) ────────────────────────────────

/**
 * A single input connection — resolved from a link ID to its source reference.
 * This is the UI-friendly version of a resolved `NodeInput.link`.
 */
export type UIInputConnection = {
    /** Name of the input slot (e.g. "model", "image", "positive"). */
    name: string;
    /** Data type carried by this input (e.g. "MODEL", "IMAGE", "CONDITIONING"). */
    type: DataType;
    /** Source node ID that feeds into this input. */
    sourceNodeId: string;
    /** Which output slot on the source node is connected. */
    sourceSlot: number;
    /** Original link ID from the workflow, if available. */
    linkId?: number;
};

/**
 * A single output slot — metadata about what a node produces.
 */
export type UIOutputSlot = {
    /** Name of the output slot (e.g. "MODEL", "IMAGE", "CONDITIONING"). */
    name: string;
    /** Data type of this output (e.g. "MODEL", "IMAGE", "CONDITIONING"). */
    type: DataType;
    /** Number of downstream connections from this output. */
    connectionCount: number;
    /** Slot index on the node. */
    slotIndex: number;
    /** Whether this output returns a list type. */
    isList?: boolean;
};

/**
 * Widget value with metadata — a single UI control on the node.
 * In workflow format, widgets are ordered by the node type's INPUT_TYPES().
 * In API prompt format, they are merged into the flat `inputs` dict.
 */
export type UIWidget = {
    /** Widget value (string, number, boolean, or complex object). */
    value: unknown;
    /** Index of this widget in the widgets_values array. */
    index: number;
    /**
     * Inferred widget name — the API prompt input key for this widget.
     *
     * Populated for unregistered nodes from the workflow JSON's `inputs`
     * array (each converted-to-input slot carries `widget.name`) or from
     * the Record-style `widgets_values` keys. Registered nodes use the
     * registry instead and leave this `undefined`.
     *
     * Also populated when parsing API prompt format (the `inputs` dict
     * key IS the widget name).
     */
    inferredName?: string;
};

/**
 * Resolved link in the UI — the full link info from the workflow.
 */
export type UILink = {
    /** Unique link identifier. */
    id: number;
    /** Source node ID. */
    sourceNodeId: string;
    /** Source output slot index. */
    sourceSlot: number;
    /** Target node ID. */
    targetNodeId: string;
    /** Target input slot index. */
    targetSlot: number;
    /** Data type carried by this link. */
    dataType: DataType;
};

/**
 * Execution mode display info — what the mode enum means visually.
 */
export const MODE_LABELS: Record<number, string> = {
    [0]: 'Always',       // LGraphEventMode.ALWAYS
    [1]: 'On Event',     // LGraphEventMode.ON_EVENT
    [2]: 'Disabled',     // LGraphEventMode.NEVER
    [3]: 'On Trigger',   // LGraphEventMode.ON_TRIGGER
    [4]: 'Bypass',       // LGraphEventMode.BYPASS
};

/**
 * Execution mode CSS class hints for visual styling.
 */
export const MODE_STYLES: Record<number, { color: string; muted: boolean }> = {
    0: { color: 'inherit', muted: false },
    1: { color: 'inherit', muted: false },
    2: { color: '#77819a', muted: true },  // theme.textFaint
    3: { color: 'inherit', muted: false },
    4: { color: '#fbbf24', muted: false }, // theme.warning — bypassed
};

/**
 * UINode — the dashboard's enriched node representation.
 *
 * Produced by parsing either:
 * - A `WorkflowNode` (from WorkflowJSON / WorkflowJSON04.nodes[])
 * - An `ApiPromptNode` (from ApiPrompt dict values)
 *
 * Carries both the raw data needed for prompt reconstruction and the
 * display metadata needed for rich rendering.
 */
export type UINode = {
    /** Unique node ID (string form for uniform handling). */
    id: string;

    /** Node class type (e.g. "KSampler", "CheckpointLoaderSimple", "CLIPTextEncode"). */
    classType: string;

    /**
     * Optional user-facing title from the workflow JSON (`title` on
     * workflow nodes, `_meta.title` on API prompt nodes). When present it
     * overrides the class type as the displayed node name.
     */
    title?: string;

    /** Resolved input connections — only slots that have a wire connected. */
    connections: UIInputConnection[];

    /** Output slot metadata — what this node produces. */
    outputs: UIOutputSlot[];

    /** Widget values — UI control states, indexed by position. */
    widgets: UIWidget[];

    /** Execution mode — 0=Always, 2=Disabled, 4=Bypass. See LGraphEventMode. */
    mode: number;

    /** Execution order — lower values execute first. */
    order: number;

    /** Node metadata (S&R name, CNR id, version, required models). */
    properties: NodeProperties;

    /** Visual/behavioral flags (collapsed, pinned, horizontal, etc.). */
    flags: NodeFlags;

    /** Canvas position [x, y] in pixels. */
    position: [number, number];

    /** Display size [width, height] in pixels. */
    size: [number, number];

    /** Node color (header) — CSS color string. */
    color?: string;

    /** Node body background color — CSS color string. */
    bgColor?: string;

    // ── Subgraph fields ──────────────────────────────────────────────
    //
    // When `subgraphDef` is present, this node references a subgraph definition.
    // The subgraph's `inputs[]` become this node's input slots,
    // and its `outputs[]` become this node's output slots.
    // `subgraphNodes` contains the internal nodes for nested display.
    // A UUID `type` on a WorkflowNode matches a SubgraphDefinition.id.

    /** The subgraph definition — present when this node is a subgraph. */
    subgraphDef?: SubgraphDefinition;

    /** Internal nodes inside the subgraph, parsed to UINode for nested rendering. */
    subgraphNodes?: UINode[];

    /** Internal links inside the subgraph. */
    subgraphLinks?: ComfyLink[];

    /** Internal groups inside the subgraph. */
    subgraphGroups?: Group[];

    /** The raw workflow node this was parsed from (for round-tripping). */
    _raw?: WorkflowNode;

    /** The raw API prompt node this was parsed from (for prompt reconstruction). */
    _rawApi?: ApiPromptNode;

    /**
     * Source format indicator — helps with faithful round-trip serialization.
     * - "workflow-v1": parsed from WorkflowJSON (v1 object links)
     * - "workflow-v04": parsed from WorkflowJSON04 (v0.4 tuple links)
     * - "api-prompt": parsed from ApiPrompt flat dict
     */
    _sourceFormat: 'workflow-v1' | 'workflow-v04' | 'api-prompt';
};
