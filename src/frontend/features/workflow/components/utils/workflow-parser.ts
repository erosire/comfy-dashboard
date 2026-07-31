// ComfyUI workflow JSON parsing — turns a raw workflow (v1, v0.4, or API
// prompt format) into the dashboard's UINode tree, recursively expanding
// subgraph (group node) definitions.
//
// Extracted verbatim from the original CloudTab.tsx.

import type {
    ApiPromptNode,
    ComfyLink,
    ComfyLinkTuple,
    DataType,
    NodeInput,
    NodeOutput,
    SubgraphDefinition,
    WorkflowNode
} from '../../../../../comfy';
import { comfyNodeRegistry, isApiLinkRef } from '../../../../../comfy';
import type { UIInputConnection, UINode, UIOutputSlot, UIWidget } from '../../../../nodes/node-type';
import type { BoundaryLink } from './types';

// ── Subgraph detection ──────────────────────────────────────────────────
//
// ComfyUI v1.45+ uses subgraphs (group nodes) — reusable node types
// defined by an internal graph. A subgraph node in the parent workflow
// has a UUID string as its `type`, matching a `SubgraphDefinition.id`
// from `workflow.definitions.subgraphs[]`.
//
// Regular node types are human-readable: "KSampler", "CLIPTextEncode", etc.
// UUID types always indicate a subgraph reference.

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check if a node type string is a UUID (indicating a subgraph node). */
export function isSubgraphType(type: string): boolean {
    return UUID_PATTERN.test(type);
}

/** Look up a subgraph definition by UUID from a workflow's definitions. */
export function findSubgraphDef(raw: Record<string, unknown>, subgraphId: string): SubgraphDefinition | undefined {
    const defs = raw.definitions as Record<string, unknown> | undefined;
    if (!defs) return undefined;
    const subs = defs.subgraphs as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(subs)) return undefined;
    return subs.find((sg) => sg.id === subgraphId) as SubgraphDefinition | undefined;
}

// ── Recursive subgraph-aware node parser ────────────────────────────────────

/**
 * Normalize top-level links into BoundaryLink[] for subgraph boundary
 * rewriting.  Handles both v0.4 tuple and v1 object link formats.
 */
export function buildBoundaryLinks(linkTuples: ComfyLinkTuple[], v1Links: ComfyLink[]): BoundaryLink[] {
    const result: BoundaryLink[] = [];
    if (linkTuples.length > 0) {
        for (const tuple of linkTuples) {
            if (Array.isArray(tuple) && tuple.length >= 6) {
                result.push({
                    targetNodeId: String(tuple[3]),
                    targetSlot: Number(tuple[4]),
                    sourceNodeId: String(tuple[1]),
                    sourceSlot: Number(tuple[2])
                });
            }
        }
    } else if (v1Links.length > 0) {
        for (const link of v1Links) {
            if (link && typeof link === 'object' && 'target_id' in link) {
                result.push({
                    targetNodeId: String(link.target_id),
                    targetSlot: Number(link.target_slot),
                    sourceNodeId: String(link.origin_id),
                    sourceSlot: Number(link.origin_slot)
                });
            }
        }
    }
    return result;
}

/**
 * Parse WorkflowNodes into UINodes, recursively expanding subgraph nodes.
 *
 * This is the core recursive function that handles unlimited nesting depth
 * of ComfyUI subgraph (group node) definitions.  Each level of nesting:
 *
 *   1. Detects UUID-typed nodes (subgraph references)
 *   2. Looks up the SubgraphDefinition from the top-level workflow
 *   3. Builds an internal link map from the subgraph's own links
 *   4. Rewrites boundary links (external → internal via inputNode -10)
 *   5. Recursively parses the subgraph's internal nodes
 *   6. Produces a UINode with `subgraphDef` / `subgraphNodes` populated
 */
export function parseNodesRecursive(
    rawWorkflow: Record<string, unknown>,
    nodes: WorkflowNode[],
    parentLinkMap: Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }>,
    parentBoundaryLinks: BoundaryLink[],
    sourceFormat: 'workflow-v1' | 'workflow-v04'
): UINode[] {
    const result: UINode[] = [];

    for (const n of nodes) {
        const nodeType = n.type ?? '';

        // Subgraph node: UUID type matching a definition → expand inline
        if (isSubgraphType(nodeType)) {
            const sgDef = findSubgraphDef(rawWorkflow, nodeType);
            if (sgDef) {
                const sgNodeId = String(n.id);

                // Build internal link map from subgraph definition
                const internalLinks = ((sgDef as any).links ?? []) as ComfyLink[];
                const internalLinkMap = buildLinkMapFromObjects(internalLinks);

                // Find boundary links targeting this subgraph node
                const externalInputByPort = new Map<number, { sourceNodeId: string; sourceSlot: number }>();
                for (const bl of parentBoundaryLinks) {
                    if (bl.targetNodeId === sgNodeId) {
                        externalInputByPort.set(bl.targetSlot, {
                            sourceNodeId: bl.sourceNodeId,
                            sourceSlot: bl.sourceSlot
                        });
                    }
                }

                // Rewrite internal links from -10 (inputNode) → external source
                (sgDef.inputs ?? []).forEach((inp, portIndex) => {
                    const ext = externalInputByPort.get(portIndex);
                    if (!ext) return;
                    for (const linkId of inp.linkIds ?? []) {
                        const existing = internalLinkMap.get(linkId);
                        if (existing && String(existing.sourceNodeId) === '-10') {
                            internalLinkMap.set(linkId, {
                                ...existing,
                                sourceNodeId: ext.sourceNodeId,
                                sourceSlot: ext.sourceSlot
                            });
                        }
                    }
                });

                // Build boundary links for nested subgraphs within this subgraph.
                // IMPORTANT: Use the rewritten internalLinkMap (not the original
                // internalLinks) so that nested subgraphs see the correct external
                // sources. Without this, a link rewritten from -10 → "74" at the
                // parent level would still appear as -10 in the nested boundary,
                // causing the nested rewrite to be a no-op and the sentinel to
                // leak into the API prompt.
                const nestedBoundaryLinks: BoundaryLink[] = internalLinks.map((link) => {
                    const rewritten = internalLinkMap.get(link.id);
                    return {
                        targetNodeId: String(link.target_id),
                        targetSlot: Number(link.target_slot),
                        sourceNodeId: rewritten ? rewritten.sourceNodeId : String(link.origin_id),
                        sourceSlot: rewritten ? rewritten.sourceSlot : Number(link.origin_slot)
                    };
                });

                // Parse internal nodes RECURSIVELY (handles unlimited nesting)
                const internalNodes = ((sgDef as any).nodes ?? []) as WorkflowNode[];
                const subgraphNodes = parseNodesRecursive(
                    rawWorkflow,
                    internalNodes,
                    internalLinkMap,
                    nestedBoundaryLinks,
                    sourceFormat
                );

                // Build the parent subgraph UINode with definition ports.
                // Only ports that are wired externally become connections, and
                // they carry the REAL external source (from the parent's link
                // map) — not placeholder ids. This is required for:
                //   1. Execution-order sorting: the wrapper must sort after the
                //      nodes that actually feed it.
                //   2. Display: the card renders the true source link instead of
                //      a bogus "→ [-1]" placeholder.
                const sgInputConnections: UIInputConnection[] = (sgDef.inputs ?? [])
                    .map((inp, portIndex): UIInputConnection | null => {
                        const ext = externalInputByPort.get(portIndex);
                        if (!ext) return null; // port not wired externally
                        return {
                            name: inp.name,
                            type: inp.type as DataType,
                            sourceNodeId: ext.sourceNodeId,
                            sourceSlot: ext.sourceSlot,
                            linkId: undefined
                        };
                    })
                    .filter((c): c is UIInputConnection => c !== null);

                const sgOutputSlots: UIOutputSlot[] = (sgDef.outputs ?? []).map((out, i) => ({
                    name: out.name,
                    type: out.type as DataType,
                    connectionCount: 0,
                    slotIndex: i
                }));

                result.push({
                    id: sgNodeId,
                    classType: (sgDef as any).name ?? nodeType,
                    connections: sgInputConnections,
                    outputs: sgOutputSlots,
                    widgets: [],
                    mode: n.mode ?? 0,
                    order: n.order ?? 0,
                    properties: n.properties ?? {},
                    flags: n.flags ?? {},
                    position: n.pos ?? [0, 0],
                    size: n.size ?? [200, 100],
                    color: n.color,
                    bgColor: n.bgcolor,
                    _raw: n,
                    _sourceFormat: sourceFormat,
                    subgraphDef: sgDef,
                    subgraphNodes,
                    subgraphLinks: internalLinks
                });
                continue;
            }
        }

        // Regular node
        result.push(workflowNodeToUINode(n, parentLinkMap, sourceFormat));
    }

    return result;
}

// ── Link map builders ───────────────────────────────────────────────────

/** Build a link map from v0.4 tuple links: [linkId, srcNode, srcSlot, tgtNode, tgtSlot, dataType]. */
export function buildLinkMapFromTuples(links: ComfyLinkTuple[]): Map<
    number,
    {
        sourceNodeId: string;
        sourceSlot: number;
        dataType: DataType;
    }
> {
    const map = new Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }>();
    for (const link of links) {
        // ComfyLinkTuple: [linkId, srcNode, srcSlot, tgtNode, tgtSlot, dataType]
        if (Array.isArray(link) && link.length >= 6) {
            map.set(Number(link[0]), {
                sourceNodeId: String(link[1]),
                sourceSlot: Number(link[2]),
                dataType: link[5] as DataType
            });
        }
    }
    return map;
}

/** Build a link map from v1 object links. */
export function buildLinkMapFromObjects(links: ComfyLink[]): Map<
    number,
    {
        sourceNodeId: string;
        sourceSlot: number;
        dataType: DataType;
    }
> {
    const map = new Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }>();
    for (const link of links) {
        map.set(link.id, {
            sourceNodeId: String(link.origin_id),
            sourceSlot: Number(link.origin_slot),
            dataType: link.type
        });
    }
    return map;
}

/** Build output slot metadata from a WorkflowNode. */
export function buildOutputSlots(node: WorkflowNode): UIOutputSlot[] {
    if (!node.outputs) return [];
    return node.outputs.map((out: NodeOutput, i: number) => ({
        name: out.name ?? `output_${i}`,
        type: out.type ?? '*',
        connectionCount: Array.isArray(out.links) ? out.links.length : 0,
        slotIndex: Number(out.slot_index ?? i),
        isList: out.type_is_list
    }));
}

/** Resolve connections from node inputs using the link map. */
export function resolveConnections(
    inputs: NodeInput[] | undefined,
    linkMap: Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }>
): UIInputConnection[] {
    if (!inputs) return [];
    const connections: UIInputConnection[] = [];
    for (const inp of inputs) {
        const linkId = inp.link != null ? Number(inp.link) : null;
        if (linkId != null && linkMap.has(linkId)) {
            const ref = linkMap.get(linkId)!;
            connections.push({
                name: inp.name,
                type: ref.dataType,
                sourceNodeId: ref.sourceNodeId,
                sourceSlot: ref.sourceSlot,
                linkId
            });
        }
    }
    return connections;
}

/** Parse a WorkflowNode (from v1 or v0.4 workflow) into a UINode. */
export function workflowNodeToUINode(
    node: WorkflowNode,
    linkMap: Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }>,
    sourceFormat: 'workflow-v1' | 'workflow-v04'
): UINode {
    const connections = resolveConnections(node.inputs, linkMap);
    const outputs = buildOutputSlots(node);

    // Build widget list — widgets_values can be array or record
    const widgets: UIWidget[] = [];
    if (Array.isArray(node.widgets_values)) {
        node.widgets_values.forEach((val, i) => {
            widgets.push({ value: val, index: i });
        });
    } else if (node.widgets_values && typeof node.widgets_values === 'object') {
        // Record<string, unknown> form — newer format. The key IS the
        // widget name, so record it for unregistered-node fallback.
        Object.entries(node.widgets_values as Record<string, unknown>).forEach(([key, val], i) => {
            widgets.push({ value: val, index: i, inferredName: key });
        });
    }

    // For unregistered nodes, infer widget names from converted-to-input
    // slots. Each entry in `inputs` with a `widget` field is a widget that
    // was promoted to an input slot; its `widget.name` (or the slot's own
    // `name`) is the API prompt input key. We assume the Nth converted
    // widget maps to the Nth `widgets_values` entry — this holds when
    // widgets are converted in INPUT_TYPES order (the common case, and
    // always true for subgraph-promoted widgets).
    if (!comfyNodeRegistry[node.type ?? '']) {
        const convertedNames: string[] = [];
        for (const inp of node.inputs ?? []) {
            const widgetField = inp.widget as { name?: string } | undefined;
            const name = widgetField?.name ?? inp.name;
            if (widgetField && typeof name === 'string') {
                convertedNames.push(name);
            }
        }
        for (let i = 0; i < convertedNames.length && i < widgets.length; i++) {
            widgets[i] = { ...widgets[i], inferredName: convertedNames[i] };
        }
    }

    return {
        id: String(node.id),
        classType: node.type ?? 'Unknown',
        title: typeof node.title === 'string' && node.title.length > 0 ? node.title : undefined,
        connections,
        outputs,
        widgets,
        mode: node.mode ?? 0,
        order: node.order ?? 0,
        properties: node.properties ?? {},
        flags: node.flags ?? {},
        position: node.pos ?? [0, 0],
        size: node.size ?? [200, 100],
        color: node.color,
        bgColor: node.bgcolor,
        _raw: node,
        _sourceFormat: sourceFormat
    };
}

/**
 * Parse an API prompt node into a UINode.
 *
 * In API prompt format, `inputs` is a flat dict mixing:
 * - Link references: [nodeId (string), slotIndex (number)]
 * - Widget values: string, number, boolean, object
 *
 * We separate them into connections vs widgets.
 */
export function apiPromptNodeToUINode(id: string, node: ApiPromptNode): UINode {
    const connections: UIInputConnection[] = [];
    const widgets: UIWidget[] = [];
    let widgetIdx = 0;

    for (const [key, val] of Object.entries(node.inputs)) {
        if (isApiLinkRef(val)) {
            connections.push({
                name: key,
                type: '*', // API prompt doesn't carry type info per-link
                sourceNodeId: val[0],
                sourceSlot: val[1]
            });
        } else {
            // The key IS the widget name in API prompt format — record it
            // so unregistered nodes can round-trip correctly.
            widgets.push({ value: val, index: widgetIdx++, inferredName: key });
        }
    }

    return {
        id,
        classType: node.class_type ?? 'Unknown',
        title:
            typeof node._meta?.title === 'string' && node._meta.title.length > 0
                ? node._meta.title
                : undefined,
        connections,
        outputs: [], // API prompt doesn't carry output info
        widgets,
        mode: 0, // API prompt doesn't carry mode info
        order: 0,
        properties: {},
        flags: {},
        position: [0, 0],
        size: [200, 100],
        _rawApi: node,
        _sourceFormat: 'api-prompt'
    };
}

/**
 * Parse a raw ComfyUI JSON into UINode[].
 *
 * Handles three formats:
 * 1. **Workflow v1**: `{ version: 1, nodes: [...], links: [...objects] }`
 * 2. **Workflow v0.4**: `{ version: 0.4, nodes: [...], links: [...tuples] }`
 * 3. **API prompt**: `{ "1": { class_type, inputs }, ... }` or `{ prompt: { ... } }`
 *
 * Auto-detects which format based on shape of the JSON.
 */
export function parseWorkflowJson(raw: Record<string, unknown>): UINode[] {
    // ── Workflow format (v1 or v0.4) ──────────────────────────────────
    // Detected by presence of `nodes` array.
    if (Array.isArray(raw.nodes)) {
        const version = typeof raw.version === 'number' ? raw.version : 0.4;
        const sourceFormat = version >= 1 ? 'workflow-v1' : 'workflow-v04';

        // Build link map based on format
        let linkMap: Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }>;
        let linkTuples: ComfyLinkTuple[] = [];

        if (Array.isArray(raw.links) && raw.links.length > 0) {
            const firstLink = raw.links[0];
            if (Array.isArray(firstLink)) {
                // v0.4 tuple links
                linkTuples = raw.links as ComfyLinkTuple[];
                linkMap = buildLinkMapFromTuples(linkTuples);
            } else {
                // v1 object links
                linkMap = buildLinkMapFromObjects(raw.links as ComfyLink[]);
            }
        } else {
            linkMap = new Map();
        }

        const nodes = raw.nodes as WorkflowNode[];
        const parentBoundaryLinks = buildBoundaryLinks(linkTuples, (raw.links as ComfyLink[]) ?? []);
        return parseNodesRecursive(raw, nodes, linkMap, parentBoundaryLinks, sourceFormat);
    }

    // ── API prompt format ─────────────────────────────────────────────
    // Could be: { prompt: { "1": { class_type, inputs } } }
    // Or flat: { "1": { class_type, inputs }, ... }
    let promptDict: Record<string, unknown>;

    if ('prompt' in raw && typeof raw.prompt === 'object' && raw.prompt !== null) {
        promptDict = raw.prompt as Record<string, unknown>;
    } else {
        promptDict = raw;
    }

    const nodes: UINode[] = [];
    for (const [id, value] of Object.entries(promptDict)) {
        // Skip known top-level keys that aren't node entries
        if (
            id === 'extra' ||
            id === 'config' ||
            id === 'groups' ||
            id === 'links' ||
            id === 'version' ||
            id === 'prompt'
        )
            continue;

        if (value && typeof value === 'object' && 'class_type' in value) {
            nodes.push(apiPromptNodeToUINode(id, value as ApiPromptNode));
        }
    }
    return nodes;
}
