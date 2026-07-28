// CloudTab — Beam cloud workflow runner.
//
// Two-panel layout:
//   Left sidebar: saved workflows list (from store) with search
//   Right content: workflow editor (drop, edit, submit)
//
// Integrates with DashboardStore for CRUD operations on workflows.
// Manages pod lifecycle and prompt execution for cloud runs.

import React from 'react';
import styled from '@emotion/styled';
import { theme } from '../styles';
import { ComfyDashboard } from './ComfyDashboard';
import { cloudCreate, cloudPrompt, cloudReadNdjson } from '../api/cloud';
import { useDashboardStore } from '../context';
import { isApiLinkRef, comfyNodeRegistry, getWidgetLabel } from '../../comfy';
import type { CloudStreamEvent } from '../api/cloud';
import type { WorkflowMeta } from '../api';
import type {
    WorkflowNode,
    NodeInput,
    NodeOutput,
    ApiPromptNode,
    ComfyLink,
    ComfyLinkTuple,
    DataType,
    SubgraphDefinition,
} from '../../comfy';
import type {
    UINode,
    UIInputConnection,
    UIOutputSlot,
    UIWidget,
} from '../nodes/node-type';
import { MODE_LABELS, MODE_STYLES } from '../nodes/node-type';

type PodState =
    | { status: 'idle' }
    | { status: 'spawning' }
    | { status: 'ready'; container_id: string; pod_url: string }
    | { status: 'error'; message: string };

type RunState =
    | { status: 'idle' }
    | { status: 'running'; events: CloudStreamEvent[] }
    | { status: 'done'; events: CloudStreamEvent[] }
    | { status: 'error'; events: CloudStreamEvent[]; message: string };

// ── Styled: shared ────────────────────────────────────────────────────

const Btn = styled('button')({
    padding: '5px 14px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface1,
    color: theme.textMuted,
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`,
});

const BtnPrimary = styled('button')({
    padding: '5px 14px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    border: `1px solid ${theme.accent}`,
    backgroundColor: theme.accent,
    color: '#ffffff',
    transition: `background-color ${theme.transition}`,
});

const BtnDanger = styled('button')({
    padding: '5px 14px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    border: `1px solid ${theme.dangerBorder}`,
    backgroundColor: theme.dangerSoft,
    color: theme.danger,
    transition: `background-color ${theme.transition}, color ${theme.transition}`,
});



const Badge = styled('span')({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: theme.fontSize.xs,
    color: theme.textDim,
    padding: '2px 8px',
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surface2,
    border: `1px solid ${theme.border}`,
});

const BadgeDot = styled('span')({
    width: 6,
    height: 6,
    borderRadius: '50%',
    flex: '0 0 auto',
});

const SpinnerEl = styled('span')({
    display: 'inline-block',
    width: 12,
    height: 12,
    border: `2px solid rgba(129, 140, 248, 0.30)`,
    borderTopColor: theme.accent,
    borderRadius: '50%',
    animation: 'sg-spin 700ms linear infinite',
});

const SectionLabel = styled('div')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.textDim,
    marginBottom: 6,
});

const ToggleButton = styled('button')({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    flex: '0 0 auto',
    borderRadius: theme.radiusMd,
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface1,
    color: theme.text,
    cursor: 'pointer',
    fontSize: theme.fontSize.xl,
    lineHeight: 1,
    padding: 0,
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`,
});

const HeaderTitle = styled('span')({
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.text,
    letterSpacing: 0.2,
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
});

// ── Styled: left sidebar (workflow list) ─────────────────────────────

const SidebarPanel = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
});

const SidebarHeader = styled('div')({
    padding: '10px 12px 6px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
});

const SidebarSearch = styled('div')({
    padding: '0 12px 8px',
    flex: '0 0 auto',
});

const SearchInput = styled('input')({
    width: '100%',
    padding: '5px 8px',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.text,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none',
    boxSizing: 'border-box' as const,
    transition: `border-color ${theme.transition}`,
});

const SidebarScroll = styled('div')({
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: '0 6px 12px',
});

const EmptyHint = styled('div')({
    padding: '20px 0',
    fontSize: theme.fontSize.sm,
    color: theme.textFaint,
    textAlign: 'center' as const,
    lineHeight: 1.5,
});

const WorkflowItem = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 10px',
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`,
    border: `1px solid transparent`,
    marginBottom: 2,
});

const WorkflowItemActive = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 10px',
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`,
    border: `1px solid ${theme.accentRing}`,
    marginBottom: 2,
    backgroundColor: theme.accentSoft,
});

const WorkflowItemName = styled('div')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
});

const WorkflowItemCount = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.accent2,
    fontWeight: 400,
});

const SidebarCount = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    fontWeight: 400,
});

// ── Styled: right content (editor) ────────────────────────────────────

const EditorArea = styled('div')({
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: '14px 24px',
});

const EditorAreaEmpty = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    border: `2px dashed ${theme.border}`,
    margin: 14,
    borderRadius: theme.radiusLg,
    cursor: 'pointer',
    transition: `border-color ${theme.transition}, background-color ${theme.transition}`,
    color: theme.textDim,
    fontSize: theme.fontSize.body,
    boxSizing: 'border-box' as const,
    flex: '1 1 auto',
});

const DropTitle = styled('div')({
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.textMuted,
});

const DropHint = styled('div')({
    fontSize: theme.fontSize.sm,
    color: theme.textDim,
});

const NodeList = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
});

const NodeCard = styled('div')({
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface1,
    overflow: 'hidden',
});

const NodeHeader = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    backgroundColor: theme.surface2,
    borderBottom: `1px solid ${theme.border}`,
});

const NodeId = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    fontFamily: theme.fontMono,
});

const NodeClassType = styled('span')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.accent,
});

const NodeInputs = styled('div')({
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
});

const InputRow = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
});

const InputLabel = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.textDim,
    fontFamily: theme.fontMono,
    minWidth: 80,
    flex: '0 0 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
});

const InputField = styled('input')({
    flex: '1 1 auto',
    padding: '3px 6px',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.text,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none',
    minWidth: 0,
});

const LinkBadge = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.accent2,
    fontFamily: theme.fontMono,
    padding: '1px 5px',
    borderRadius: theme.radiusSm,
    backgroundColor: 'rgba(147, 180, 212, 0.12)',
    border: '1px solid rgba(147, 180, 212, 0.25)',
});

// ── Styled: save dialog ──────────────────────────────────────────────

const DialogOverlay = styled('div')({
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
});

const DialogBox = styled('div')({
    backgroundColor: theme.surface2,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusLg,
    padding: 20,
    minWidth: 360,
    maxWidth: 480,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
});

const DialogTitle = styled('div')({
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.text,
});

const DialogField = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
});

const DialogLabel = styled('label')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.textDim,
});

const DialogInput = styled('input')({
    padding: '6px 10px',
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontSans,
    color: theme.text,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none',
    transition: `border-color ${theme.transition}`,
});

const DialogActions = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
});

// ── SubgraphNodeCard — renders a UINode with the same card as regular nodes ─

const SubgraphNodeCard: React.FC<{
    node: UINode;
    isRunning: boolean;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
}> = React.memo(({ node, isRunning, updateNodeWidget }) => {
    const isSubgraph = !!node.subgraphDef;
    const registryEntry = comfyNodeRegistry[node.classType];
    const isUnregistered = !isSubgraph && !registryEntry;
    return (
    <NodeCard style={isUnregistered
        ? { marginLeft: 8, border: `1px solid ${theme.dangerBorder}`, backgroundColor: theme.dangerSoft }
        : { marginLeft: 8, borderLeft: `2px solid ${theme.accent}30` }
    }>
        <NodeHeader style={isUnregistered ? { backgroundColor: 'rgba(248, 113, 113, 0.20)' } : undefined}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <NodeClassType style={isUnregistered ? { color: theme.danger } : undefined}>
                    {registryEntry?.displayName ?? node.classType}
                </NodeClassType>
                {isUnregistered && (
                    <span style={{
                        fontSize: theme.fontSize.xs,
                        color: theme.danger,
                        border: `1px solid ${theme.dangerBorder}`,
                        borderRadius: theme.radiusSm,
                        padding: '0 4px',
                        backgroundColor: theme.dangerSoft,
                    }}>
                        not registered
                    </span>
                )}
                {node.mode !== 0 && (
                    <span style={{
                        fontSize: theme.fontSize.xs,
                        color: MODE_STYLES[node.mode]?.color ?? theme.textFaint,
                        opacity: MODE_STYLES[node.mode]?.muted ? 0.6 : 1,
                        fontStyle: 'italic',
                    }}>
                        [{MODE_LABELS[node.mode] ?? `mode ${node.mode}`}]
                    </span>
                )}
            </div>
            <NodeId>#{node.id}</NodeId>
        </NodeHeader>
        <NodeInputs>
            {node.connections.map((conn) => (
                <InputRow key={`conn-${conn.name}`}>
                    <InputLabel style={{ color: dataTypeColor(conn.type) }}>{conn.name}</InputLabel>
                    <LinkBadge style={{
                        color: dataTypeColor(conn.type),
                        borderColor: `${dataTypeColor(conn.type)}40`,
                        backgroundColor: `${dataTypeColor(conn.type)}12`,
                    }}>
                        → {conn.sourceNodeId}[{conn.sourceSlot}]
                        {conn.type !== '*' && (
                            <span style={{ marginLeft: 4, opacity: 0.7, fontSize: '0.9em' }}>
                                {dataTypeLabel(conn.type)}
                            </span>
                        )}
                    </LinkBadge>
                </InputRow>
            ))}
            {node.widgets.map((widget) => (
                <InputRow key={`w${widget.index}`}>
                    <InputLabel>{getWidgetLabel(node.classType, widget.index)}</InputLabel>
                    <InputField
                        type="text"
                        value={displayValue(widget.value)}
                        onChange={(e) => updateNodeWidget(node.id, widget.index, e.target.value)}
                        readOnly={isRunning}
                    />
                </InputRow>
            ))}
            {node.outputs.length > 0 && (
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap' as const,
                    gap: 4,
                    marginTop: 4,
                    paddingTop: 4,
                    borderTop: `1px solid ${theme.border}`,
                }}>
                    <span style={{ fontSize: theme.fontSize.xs, color: theme.textFaint, marginRight: 2 }}>outputs:</span>
                    {node.outputs.map((out) => (
                        <span
                            key={`out-${out.slotIndex}`}
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: dataTypeColor(out.type),
                                fontFamily: theme.fontMono,
                                padding: '0 4px',
                                borderRadius: theme.radiusSm,
                                backgroundColor: `${dataTypeColor(out.type)}12`,
                                border: `1px solid ${dataTypeColor(out.type)}25`,
                            }}
                        >
                            {out.name}
                            {out.connectionCount > 0 && <span style={{ opacity: 0.6 }}> ({out.connectionCount})</span>}
                            {out.isList && <span style={{ opacity: 0.6 }}> []</span>}
                        </span>
                    ))}
                </div>
            )}
            {(node.properties['Node name for S&R'] || node.properties.ver) && (
                <div style={{
                    display: 'flex',
                    flexWrap: 'wrap' as const,
                    gap: 6,
                    marginTop: 4,
                    paddingTop: 4,
                    borderTop: `1px solid ${theme.border}`,
                }}>
                    {node.properties['Node name for S&R'] && (
                        <span style={{ fontSize: theme.fontSize.xs, color: theme.textDim }}>
                            S&amp;R: {node.properties['Node name for S&R']}
                        </span>
                    )}
                    {node.properties.ver && (
                        <span style={{ fontSize: theme.fontSize.xs, color: theme.textDim }}>
                            v{node.properties.ver}
                        </span>
                    )}
                    {node.properties.cnr_id && (
                        <span style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}>
                            CNR: {node.properties.cnr_id}
                        </span>
                    )}
                </div>
            )}
            {node.connections.length === 0 && node.widgets.length === 0 && node.outputs.length === 0 && (
                <div style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}>No inputs</div>
            )}
            {/* Recurse into nested subgraphs */}
            {node.subgraphNodes && node.subgraphNodes.length > 0 && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${theme.accent}30` }}>
                    <div style={{ fontSize: theme.fontSize.xs, color: theme.accent, fontWeight: 600, marginBottom: 4 }}>
                        ◈ {node.subgraphNodes.length} internal node{node.subgraphNodes.length !== 1 ? 's' : ''}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {node.subgraphNodes.map((inner) => (
                            <SubgraphNodeCard key={inner.id} node={inner} isRunning={isRunning} updateNodeWidget={updateNodeWidget} />
                        ))}
                    </div>
                </div>
            )}
        </NodeInputs>
    </NodeCard>
    );
});

// ── Helpers ────────────────────────────────────────────────────────────

// ── Subgraph detection ──────────────────────────────────────────────────
//
// ComfyUI v1.45+ uses subgraphs (group nodes) — reusable node types
// defined by an internal graph. A subgraph node in the parent workflow
// has a UUID string as its `type`, matching a `SubgraphDefinition.id`
// from `workflow.definitions.subgraphs[]`.
//
// Regular node types are human-readable: "KSampler", "CLIPTextEncode", etc.
// UUID types always indicate a subgraph reference.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check if a node type string is a UUID (indicating a subgraph node). */
function isSubgraphType(type: string): boolean {
    return UUID_PATTERN.test(type);
}

/** Look up a subgraph definition by UUID from a workflow's definitions. */
function findSubgraphDef(
    raw: Record<string, unknown>,
    subgraphId: string
): SubgraphDefinition | undefined {
    const defs = raw.definitions as Record<string, unknown> | undefined;
    if (!defs) return undefined;
    const subs = defs.subgraphs as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(subs)) return undefined;
    return subs.find((sg) => sg.id === subgraphId) as SubgraphDefinition | undefined;
}

// ── Recursive subgraph-aware node parser ────────────────────────────────────

/**
 * Normalized link for boundary rewriting — works for both v0.4 tuple and v1
 * object formats.  Used to resolve external inputs flowing into a subgraph.
 */
type BoundaryLink = {
    targetNodeId: string;
    targetSlot: number;
    sourceNodeId: string;
    sourceSlot: number;
};

/**
 * Normalize top-level links into BoundaryLink[] for subgraph boundary
 * rewriting.  Handles both v0.4 tuple and v1 object link formats.
 */
function buildBoundaryLinks(
    linkTuples: ComfyLinkTuple[],
    v1Links: ComfyLink[],
): BoundaryLink[] {
    const result: BoundaryLink[] = [];
    if (linkTuples.length > 0) {
        for (const tuple of linkTuples) {
            if (Array.isArray(tuple) && tuple.length >= 6) {
                result.push({
                    targetNodeId: String(tuple[3]),
                    targetSlot: Number(tuple[4]),
                    sourceNodeId: String(tuple[1]),
                    sourceSlot: Number(tuple[2]),
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
                    sourceSlot: Number(link.origin_slot),
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
function parseNodesRecursive(
    rawWorkflow: Record<string, unknown>,
    nodes: WorkflowNode[],
    parentLinkMap: Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }>,
    parentBoundaryLinks: BoundaryLink[],
    sourceFormat: 'workflow-v1' | 'workflow-v04',
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
                            sourceSlot: bl.sourceSlot,
                        });
                    }
                }

                // Rewrite internal links from -10 (inputNode) → external source
                (sgDef.inputs ?? []).forEach((inp, portIndex) => {
                    const ext = externalInputByPort.get(portIndex);
                    if (!ext) return;
                    for (const linkId of (inp.linkIds ?? [])) {
                        const existing = internalLinkMap.get(linkId);
                        if (existing && String(existing.sourceNodeId) === '-10') {
                            internalLinkMap.set(linkId, {
                                ...existing,
                                sourceNodeId: ext.sourceNodeId,
                                sourceSlot: ext.sourceSlot,
                            });
                        }
                    }
                });

                // Build boundary links for nested subgraphs within this subgraph
                const nestedBoundaryLinks: BoundaryLink[] = internalLinks.map((link) => ({
                    targetNodeId: String(link.target_id),
                    targetSlot: Number(link.target_slot),
                    sourceNodeId: String(link.origin_id),
                    sourceSlot: Number(link.origin_slot),
                }));

                // Parse internal nodes RECURSIVELY (handles unlimited nesting)
                const internalNodes = ((sgDef as any).nodes ?? []) as WorkflowNode[];
                const subgraphNodes = parseNodesRecursive(
                    rawWorkflow,
                    internalNodes,
                    internalLinkMap,
                    nestedBoundaryLinks,
                    sourceFormat,
                );

                // Build the parent subgraph UINode with definition ports
                const sgInputConnections: UIInputConnection[] = (sgDef.inputs ?? []).map((inp) => ({
                    name: inp.name,
                    type: inp.type as DataType,
                    sourceNodeId: '',
                    sourceSlot: -1,
                    linkId: undefined,
                }));

                const sgOutputSlots: UIOutputSlot[] = (sgDef.outputs ?? []).map((out, i) => ({
                    name: out.name,
                    type: out.type as DataType,
                    connectionCount: 0,
                    slotIndex: i,
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
                    subgraphLinks: internalLinks,
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
function buildLinkMapFromTuples(links: ComfyLinkTuple[]): Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }> {
    const map = new Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }>();
    for (const link of links) {
        // ComfyLinkTuple: [linkId, srcNode, srcSlot, tgtNode, tgtSlot, dataType]
        if (Array.isArray(link) && link.length >= 6) {
            map.set(Number(link[0]), {
                sourceNodeId: String(link[1]),
                sourceSlot: Number(link[2]),
                dataType: link[5] as DataType,
            });
        }
    }
    return map;
}

/** Build a link map from v1 object links. */
function buildLinkMapFromObjects(links: ComfyLink[]): Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }> {
    const map = new Map<number, { sourceNodeId: string; sourceSlot: number; dataType: DataType }>();
    for (const link of links) {
        map.set(link.id, {
            sourceNodeId: String(link.origin_id),
            sourceSlot: Number(link.origin_slot),
            dataType: link.type,
        });
    }
    return map;
}

/** Build output slot metadata from a WorkflowNode. */
function buildOutputSlots(node: WorkflowNode): UIOutputSlot[] {
    if (!node.outputs) return [];
    return node.outputs.map((out: NodeOutput, i: number) => ({
        name: out.name ?? `output_${i}`,
        type: out.type ?? '*',
        connectionCount: Array.isArray(out.links) ? out.links.length : 0,
        slotIndex: Number(out.slot_index ?? i),
        isList: out.type_is_list,
    }));
}

/** Resolve connections from node inputs using the link map. */
function resolveConnections(
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
                linkId,
            });
        }
    }
    return connections;
}

/** Parse a WorkflowNode (from v1 or v0.4 workflow) into a UINode. */
function workflowNodeToUINode(
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
        // Record<string, unknown> form — newer format
        Object.entries(node.widgets_values as Record<string, unknown>).forEach(([key, val], i) => {
            widgets.push({ value: val, index: i });
        });
    }

    return {
        id: String(node.id),
        classType: node.type ?? 'Unknown',
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
        _sourceFormat: sourceFormat,
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
function apiPromptNodeToUINode(id: string, node: ApiPromptNode): UINode {
    const connections: UIInputConnection[] = [];
    const widgets: UIWidget[] = [];
    let widgetIdx = 0;

    for (const [key, val] of Object.entries(node.inputs)) {
        if (isApiLinkRef(val)) {
            connections.push({
                name: key,
                type: '*', // API prompt doesn't carry type info per-link
                sourceNodeId: val[0],
                sourceSlot: val[1],
            });
        } else {
            widgets.push({ value: val, index: widgetIdx++ });
        }
    }

    return {
        id,
        classType: node.class_type ?? 'Unknown',
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
        _sourceFormat: 'api-prompt',
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
function parseWorkflowJson(raw: Record<string, unknown>): UINode[] {
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
        if (id === 'extra' || id === 'config' || id === 'groups' || id === 'links' || id === 'version' || id === 'prompt') continue;

        if (value && typeof value === 'object' && 'class_type' in value) {
            nodes.push(apiPromptNodeToUINode(id, value as ApiPromptNode));
        }
    }
    return nodes;
}

/** Classify and order nodes: inputs (sources) → middle → outputs (sinks). Discard unlinked. */
function sortNodes(nodes: UINode[]): UINode[] {
    const nodeIds = new Set(nodes.map((n) => n.id));

    // Which nodes does each node receive from? (incoming links)
    // Which nodes does each node feed into? (outgoing references)
    const incomingFrom = new Map<string, Set<string>>();
    const outgoingTo = new Map<string, Set<string>>();

    for (const n of nodes) {
        incomingFrom.set(n.id, new Set());
        outgoingTo.set(n.id, new Set());
    }

    for (const n of nodes) {
        for (const conn of n.connections) {
            if (nodeIds.has(conn.sourceNodeId)) {
                incomingFrom.get(n.id)!.add(conn.sourceNodeId);
                outgoingTo.get(conn.sourceNodeId)!.add(n.id);
            }
        }
    }

    const isSource = (n: UINode) => incomingFrom.get(n.id)!.size === 0;
    const isSink = (n: UINode) => outgoingTo.get(n.id)!.size === 0;

    const inputs: UINode[] = [];
    const outputs: UINode[] = [];
    const middle: UINode[] = [];

    for (const n of nodes) {
        const src = isSource(n);
        const snk = isSink(n);
        if (src && snk) {
            // Completely unlinked — discard
        } else if (src) {
            inputs.push(n);
        } else if (snk) {
            outputs.push(n);
        } else {
            middle.push(n);
        }
    }

    return [...inputs, ...middle, ...outputs];
}

/** Re-number node IDs sequentially from 1 and update all link references. */
function renumberNodes(nodes: UINode[]): UINode[] {
    const idMap = new Map<string, string>();
    nodes.forEach((n, i) => idMap.set(n.id, String(i + 1)));

    return nodes.map((n) => {
        const connections: UIInputConnection[] = n.connections.map((conn) => {
            const newSrc = idMap.get(conn.sourceNodeId);
            return newSrc != null ? { ...conn, sourceNodeId: newSrc } : conn;
        });
        // Recursively renumber subgraph internal nodes with parent-prefixed IDs
        const subgraphNodes = n.subgraphNodes
            ? renumberSubgraphNodes(n.subgraphNodes, idMap.get(n.id)!, idMap)
            : undefined;
        return { ...n, id: idMap.get(n.id)!, connections, subgraphNodes };
    });
}

/**
 * Re-number subgraph internal node IDs with a parent-prefixed scheme.
 * Internal nodes get IDs like "3-1", "3-2", etc. (where 3 is the parent subgraph ID).
 * All cross-references between internal nodes are updated accordingly.
 * References to external nodes (via externalIdMap) are also updated.
 */
function renumberSubgraphNodes(
    internalNodes: UINode[],
    parentPrefix: string,
    externalIdMap: Map<string, string>,
): UINode[] {
    const internalIdMap = new Map<string, string>();
    internalNodes.forEach((n, i) => internalIdMap.set(n.id, `${parentPrefix}-${i + 1}`));

    return internalNodes.map((n) => {
        const connections: UIInputConnection[] = n.connections.map((conn) => {
            // Check if source is another internal node first
            const newInternalSrc = internalIdMap.get(conn.sourceNodeId);
            if (newInternalSrc != null) {
                return { ...conn, sourceNodeId: newInternalSrc };
            }
            // Check if source is an external node (boundary link from subgraph input)
            const newExternalSrc = externalIdMap.get(conn.sourceNodeId);
            if (newExternalSrc != null) {
                return { ...conn, sourceNodeId: newExternalSrc };
            }
            // Unknown source — keep as-is
            return conn;
        });
        // Recursively renumber deeper subgraph nesting levels
        const myNewId = internalIdMap.get(n.id)!;
        const subgraphNodes = n.subgraphNodes && n.subgraphNodes.length > 0
            ? renumberSubgraphNodes(n.subgraphNodes, myNewId, internalIdMap)
            : undefined;
        return { ...n, id: myNewId, connections, subgraphNodes };
    });
}

function displayValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    return String(val);
}

function parseInputValue(raw: string, original: unknown): unknown {
    if (typeof original === 'number') {
        const n = Number(raw);
        return isNaN(n) ? original : n;
    }
    if (typeof original === 'boolean') {
        return raw.toLowerCase() === 'true' || raw === '1';
    }
    return raw;
}

/** Display a data type with a color hint based on common ComfyUI types. */
function dataTypeColor(type: DataType): string {
    const t = typeof type === 'string' ? type : Array.isArray(type) ? type[0] : String(type);
    switch (t) {
        case 'MODEL': return '#818cf8';        // accent (indigo)
        case 'CLIP': return '#a78bfa';         // purple
        case 'VAE': return '#f472b6';          // pink
        case 'CONDITIONING': return '#6ee7b7'; // success (green)
        case 'LATENT': return '#fbbf24';       // warning (amber)
        case 'IMAGE': return '#38bdf8';        // sky blue
        case 'MASK': return '#fb923c';         // orange
        case 'STRING': return '#c8cdd8';       // text muted
        case 'INT': return '#93b4d4';          // accent2
        case 'FLOAT': return '#93b4d4';
        case 'BOOLEAN': return '#f87171';      // danger (red)
        default: return '#8891a5';             // textDim
    }
}

/** Short label for a data type. Truncate long type names. */
function dataTypeLabel(type: DataType): string {
    if (typeof type === 'string') return type;
    if (Array.isArray(type)) return type.join('|');
    return String(type);
}

function eventSummary(event: CloudStreamEvent): string {
    switch (event.type) {
        case 'proxy_enqueue':
            return `✓ Enqueued (prompt_id: ${(event.data as any).prompt_id ?? '?'})`;
        case 'proxy_done':
            return `✓ Done`;
        case 'proxy_error':
            return `✗ Proxy error: ${(event.data as any).error ?? JSON.stringify(event.data)}`;
        case 'status':
            return `⟳ Status update`;
        case 'execution_start':
            return `▶ Execution started`;
        case 'execution_cached':
            return `⊞ Cached nodes: ${((event.data as any).nodes ?? []).length}`;
        case 'progress': {
            const d = event.data as any;
            return `● Progress: ${d.value}/${d.max} (node ${d.node})`;
        }
        case 'executing': {
            const d = event.data as any;
            return d.node ? `◆ Executing node ${d.node}` : `◇ Execution complete`;
        }
        case 'executed': {
            const d = event.data as any;
            const imgs = d.output?.images;
            return `◆ Node ${d.node} executed${imgs ? ` → ${imgs.length} image(s)` : ''}`;
        }
        case 'execution_error': {
            const d = event.data as any;
            return `✗ Error in node ${d.node_id} (${d.node_type}): ${d.exception_message}`;
        }
        case 'execution_success':
            return `✓ Execution succeeded`;
        case 'execution_interrupted':
            return `⚠ Execution interrupted`;
        case 'binary':
            return `◉ Binary preview frame`;
        default:
            return `${event.type}`;
    }
}

// ── Component ──────────────────────────────────────────────────────────

export type CloudTabProps = {
    baseUrl?: string;
};

export const CloudTab: React.FC<CloudTabProps> = React.memo(({
    baseUrl = 'http://192.168.8.128:5000/v1/comfy',
}) => {
    const {
        store,
        createWorkflow,
        deleteWorkflow,
        cloneWorkflow,
        selectWorkflow,
        searchWorkflows,
    } = useDashboardStore();

    const [nodes, setNodes] = React.useState<UINode[]>([]);
    const [rawJson, setRawJson] = React.useState<Record<string, unknown> | null>(null);
    const [fileName, setFileName] = React.useState('');
    const [pod, setPod] = React.useState<PodState>({ status: 'idle' });
    const [run, setRun] = React.useState<RunState>({ status: 'idle' });
    const [dragOver, setDragOver] = React.useState(false);
    const [podName, setPodName] = React.useState('');
    const [spawnDialogOpen, setSpawnDialogOpen] = React.useState(false);
    const [sidebarOpen, setSidebarOpen] = React.useState(() => {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(min-width: 768px)').matches;
        }
        return true;
    });
    const [searchText, setSearchText] = React.useState(store.searchQuery);

    const sidebarScrollRef = React.useRef<HTMLDivElement>(null);
    const searchDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const toggleSidebar = React.useCallback(() => setSidebarOpen((prev) => !prev), []);

    // Determine if we're editing a saved workflow (loaded from sidebar)
    const editingWorkflowId = store.selectedId;
    const isEditingSaved = editingWorkflowId !== null && rawJson !== null;

    // Auto-scroll results sidebar
    React.useEffect(() => {
        if (sidebarScrollRef.current) {
            sidebarScrollRef.current.scrollTop = sidebarScrollRef.current.scrollHeight;
        }
    }, [run]);

    // Debounced search
    const handleSearchChange = React.useCallback((value: string) => {
        setSearchText(value);
        if (searchDebounceRef.current) {
            clearTimeout(searchDebounceRef.current);
        }
        searchDebounceRef.current = setTimeout(() => {
            searchWorkflows(value);
        }, 300);
    }, [searchWorkflows]);

    // ── Load a saved workflow from sidebar ───────────────────────────

    const handleLoadWorkflow = React.useCallback((wf: WorkflowMeta) => {
        selectWorkflow(wf.id);
        // We need to fetch full workflow to get raw JSON
        // selectWorkflow already loads the full workflow into store.selectedWorkflow
    }, [selectWorkflow]);

    // When selectedWorkflow changes, parse its raw JSON into nodes
    React.useEffect(() => {
        const full = store.selectedWorkflow;
        if (full && full.raw) {
            setRawJson(full.raw);
            setNodes(renumberNodes(sortNodes(parseWorkflowJson(full.raw))));
            setFileName(`${full.name}.json`);
            setPod({ status: 'idle' });
            setRun({ status: 'idle' });
        }
    }, [store.selectedWorkflow]);

    // ── Auto-save workflow on drop ──────────────────────────────────

    const autoSaveWorkflow = React.useCallback(async (raw: Record<string, unknown>, name: string) => {
        try {
            const created = await createWorkflow({
                name,
                raw,
            });
            selectWorkflow(created.id);
        } catch (err: any) {
            alert(`Failed to auto-save: ${err.message ?? String(err)}`);
        }
    }, [createWorkflow, selectWorkflow]);

    // ── File handling ────────────────────────────────────────────────

    const handleFile = React.useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string) as Record<string, unknown>;
                setRawJson(parsed);
                setNodes(renumberNodes(sortNodes(parseWorkflowJson(parsed))));
                const name = file.name.replace(/\.json$/i, '') || 'Untitled Workflow';
                setFileName(file.name);
                setPod({ status: 'idle' });
                setRun({ status: 'idle' });
                // Auto-save the workflow with the filename as the name
                autoSaveWorkflow(parsed, name);
            } catch {
                alert('Invalid JSON file');
            }
        };
        reader.readAsText(file);
    }, [autoSaveWorkflow]);

    const handleDrop = React.useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    }, [handleFile]);

    const handleDragOver = React.useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
    }, []);

    const handleDragLeave = React.useCallback((e: React.DragEvent) => {
        const related = e.relatedTarget as HTMLElement | null;
        if (related && e.currentTarget.contains(related)) return;
        setDragOver(false);
    }, []);

    // ── Node editing ─────────────────────────────────────────────────

    const updateNodeWidget = React.useCallback((nodeId: string, widgetIdx: number, rawValue: string) => {
        /** Recursively update a widget in a node tree (handles subgraph nesting). */
        const updateInTree = (nodes: UINode[]): UINode[] =>
            nodes.map((n) => {
                if (n.id === nodeId) {
                    const widgets = n.widgets.map((w, i) =>
                        i === widgetIdx ? { ...w, value: parseInputValue(rawValue, w.value) } : w
                    );
                    return { ...n, widgets };
                }
                if (n.subgraphNodes && n.subgraphNodes.length > 0) {
                    return { ...n, subgraphNodes: updateInTree(n.subgraphNodes) };
                }
                return n;
            });
        setNodes((prev) => updateInTree(prev));
    }, []);

    // ── Build API prompt ─────────────────────────────────────────────

    const buildPrompt = React.useCallback((): Record<string, unknown> => {
        const prompt: Record<string, unknown> = {};
        for (const node of nodes) {
            // Merge linked connections with widget values back into the flat inputs dict
            const inputs: Record<string, unknown> = {};
            // Add connection link references
            for (const conn of node.connections) {
                inputs[conn.name] = [conn.sourceNodeId, conn.sourceSlot];
            }
            // Add widget values using their names from the original API format if available,
            // otherwise use widget_${index} keys
            for (const widget of node.widgets) {
                inputs[`widget_${widget.index}`] = widget.value;
            }
            prompt[node.id] = { class_type: node.classType, inputs };
        }
        return prompt;
    }, [nodes]);

    // ── Auto-save workflow on drop ──────────────────────────────────

    // ── Copy JSON to clipboard ───────────────────────────────────────

    const handleCopyJson = React.useCallback(async () => {
        if (!rawJson) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(rawJson, null, 2));
        } catch {
            alert('Failed to copy to clipboard');
        }
    }, [rawJson]);

    // ── Clone workflow ───────────────────────────────────────────────

    const handleClone = React.useCallback(async () => {
        if (!editingWorkflowId) return;
        try {
            const cloned = await cloneWorkflow(editingWorkflowId);
            // Select the clone
            selectWorkflow(cloned.id);
        } catch (err: any) {
            alert(`Failed to clone: ${err.message ?? String(err)}`);
        }
    }, [editingWorkflowId, cloneWorkflow, selectWorkflow]);

    // ── Delete workflow ──────────────────────────────────────────────

    const handleDelete = React.useCallback(async () => {
        if (!editingWorkflowId) return;
        if (!confirm('Delete this workflow permanently?')) return;
        try {
            await deleteWorkflow(editingWorkflowId);
            // Clear editor
            setNodes([]);
            setRawJson(null);
            setFileName('');
            setPod({ status: 'idle' });
            setRun({ status: 'idle' });
        } catch (err: any) {
            alert(`Failed to delete: ${err.message ?? String(err)}`);
        }
    }, [editingWorkflowId, deleteWorkflow]);

    // ── Pod spawning ─────────────────────────────────────────────────

    const handleSpawn = React.useCallback(async (name?: string) => {
        setPod({ status: 'spawning' });
        try {
            const result = await cloudCreate(baseUrl, { name: name || undefined });
            setPod({ status: 'ready', container_id: result.container_id, pod_url: result.pod_url });
        } catch (err: any) {
            setPod({ status: 'error', message: err.message ?? String(err) });
        }
    }, [baseUrl]);

    // ── Submit prompt ────────────────────────────────────────────────

    const handleSubmit = React.useCallback(async () => {
        if (pod.status !== 'ready' || nodes.length === 0) return;

        setRun({ status: 'running', events: [] });
        const prompt = buildPrompt();

        try {
            const response = await cloudPrompt(baseUrl, {
                pod_url: pod.pod_url,
                prompt,
            });

            const events: CloudStreamEvent[] = [];
            for await (const event of cloudReadNdjson(response)) {
                events.push(event);
                setRun({ status: 'running', events: [...events] });

                if (
                    event.type === 'proxy_done' ||
                    event.type === 'execution_error' ||
                    event.type === 'proxy_error' ||
                    event.type === 'execution_interrupted'
                ) {
                    const isErr = event.type !== 'proxy_done';
                    setRun({ status: isErr ? 'error' : 'done', events, message: isErr ? eventSummary(event) : '' });
                    return;
                }
            }
            setRun({ status: 'done', events });
        } catch (err: any) {
            setRun({ status: 'error', events: [], message: err.message ?? String(err) });
        }
    }, [baseUrl, pod, nodes, buildPrompt]);


    // ── Derived ──────────────────────────────────────────────────────

    const isRunning = run.status === 'running';
    const hasEvents = 'events' in run && run.events.length > 0;

    // ── Sidebar: workflow list panel ────────────────────────────────

    const sidebar = (
        <SidebarPanel>
            <SidebarHeader>
                <span>Workflows <SidebarCount>({store.workflows.length})</SidebarCount></span>
            </SidebarHeader>
            <SidebarSearch>
                <SearchInput
                    type="text"
                    placeholder="Search workflows..."
                    value={searchText}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    data-testid="workflow-search"
                />
            </SidebarSearch>
            <SidebarScroll ref={sidebarScrollRef} className="sg-scroll" data-testid="workflow-list">
                {store.workflows.length === 0 && (
                    <EmptyHint>
                        {searchText
                            ? 'No workflows match your search.'
                            : 'No saved workflows yet.\nDrop a JSON file and save it.'}
                    </EmptyHint>
                )}
                {store.workflows.map((wf) => {
                    const isActive = wf.id === editingWorkflowId;
                    const Item = isActive ? WorkflowItemActive : WorkflowItem;
                    return (
                        <Item
                            key={wf.id}
                            onClick={() => handleLoadWorkflow(wf)}
                            data-testid={`workflow-item-${wf.id}`}
                            style={isActive ? {} : undefined}
                            className={(isActive ? '' : '')}
                        >
                            <WorkflowItemName>{wf.name}</WorkflowItemName>
                        </Item>
                    );
                })}
            </SidebarScroll>
        </SidebarPanel>
    );

    // ── Content: workflow editor ─────────────────────────────────────

    const content = (
        <>
            {/* Empty state: entire area is the drop zone */}
            {nodes.length === 0 && (
                <EditorAreaEmpty
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    style={dragOver ? { borderColor: theme.accent, backgroundColor: theme.accentSoft } : undefined}
                    data-testid="cloud-drop-zone"
                >
                    <DropTitle>Drop ComfyUI JSON</DropTitle>
                    <DropHint>
                        Drag & drop a .json file to get started.
                    </DropHint>
                    {isEditingSaved && (
                        <DropHint style={{ marginTop: 8, color: theme.accent }}>
                            Currently editing: {store.selectedWorkflow?.name}
                        </DropHint>
                    )}
                </EditorAreaEmpty>
            )}

            {/* Node list */}
            {nodes.length > 0 && (
                <EditorArea
                    className="sg-scroll"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    style={dragOver ? { backgroundColor: theme.accentSoft } : undefined}
                    data-testid="cloud-content-area"
                >
                    <NodeList data-testid="cloud-node-list">
                        {dragOver && (
                            <EditorAreaEmpty
                                style={{ position: 'relative' as const, borderColor: theme.accent, backgroundColor: theme.accentSoft, minHeight: 80, margin: 0, padding: 16, flex: '0 0 auto' }}
                            >
                                <DropTitle style={{ fontSize: theme.fontSize.body }}>Drop to replace workflow</DropTitle>
                            </EditorAreaEmpty>
                        )}

                        {/* Workflow name header with Clone/Delete */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            marginBottom: 10,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                                <SectionLabel style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>
                                    {isEditingSaved && store.selectedWorkflow
                                        ? store.selectedWorkflow.name
                                        : 'Unsaved'}
                                </SectionLabel>
                                {isEditingSaved && store.selectedWorkflow?.description && (
                                    <span style={{
                                        fontSize: theme.fontSize.xs,
                                        color: theme.textFaint,
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        whiteSpace: 'nowrap' as const,
                                    }}>
                                        {store.selectedWorkflow.description}
                                    </span>
                                )}
                                <span style={{ fontSize: theme.fontSize.xs, color: theme.textFaint, whiteSpace: 'nowrap' as const }}>
                                    ({nodes.length} nodes)
                                </span>
                            </div>
                            {nodes.length > 0 && (
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                                    <Btn
                                        className="sg-hover"
                                        onClick={handleCopyJson}
                                        style={{ padding: '3px 10px', fontSize: theme.fontSize.xs }}
                                    >
                                        Copy
                                    </Btn>
                                    {isEditingSaved && (
                                        <>
                                            <Btn
                                                className="sg-hover"
                                                onClick={handleClone}
                                                style={{ padding: '3px 10px', fontSize: theme.fontSize.xs }}
                                            >
                                                Clone
                                            </Btn>
                                            <BtnDanger
                                                className="sg-danger"
                                                onClick={handleDelete}
                                                style={{ padding: '3px 10px', fontSize: theme.fontSize.xs }}
                                            >
                                                Delete
                                            </BtnDanger>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                        {nodes.map((node) => {
                            const isSubgraph = !!node.subgraphDef;
                            const registryEntry = comfyNodeRegistry[node.classType];
                            const isUnregistered = !isSubgraph && !registryEntry;
                            return (
                            <NodeCard key={node.id} data-testid={`cloud-node-${node.id}`}
                                style={isUnregistered
                                    ? { border: `1px solid ${theme.dangerBorder}`, backgroundColor: theme.dangerSoft }
                                    : isSubgraph ? { border: `1px solid ${theme.accent}40` } : undefined}
                            >
                                <NodeHeader style={{
                                    backgroundColor: node.color
                                        ? node.color
                                        : isUnregistered ? 'rgba(248, 113, 113, 0.20)'
                                        : isSubgraph ? 'rgba(129, 140, 248, 0.15)' : undefined,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                        {isSubgraph && (
                                            <span style={{ fontSize: theme.fontSize.xs, color: theme.accent, marginRight: 2 }} title="Subgraph">
                                                ◈
                                            </span>
                                        )}
                                        <NodeClassType style={
                                            isSubgraph ? { color: theme.accent }
                                            : isUnregistered ? { color: theme.danger }
                                            : undefined
                                        }>
                                            {registryEntry?.displayName ?? node.classType}
                                        </NodeClassType>
                                        {isUnregistered && (
                                            <span style={{
                                                fontSize: theme.fontSize.xs,
                                                color: theme.danger,
                                                border: `1px solid ${theme.dangerBorder}`,
                                                borderRadius: theme.radiusSm,
                                                padding: '0 4px',
                                                backgroundColor: theme.dangerSoft,
                                            }}>
                                                not registered
                                            </span>
                                        )}
                                        {registryEntry?.category && (
                                            <span style={{
                                                fontSize: theme.fontSize.xs,
                                                color: theme.textFaint,
                                                fontFamily: theme.fontMono,
                                            }}>
                                                {registryEntry.category}
                                            </span>
                                        )}
                                        {node.mode !== 0 && (
                                            <span style={{
                                                fontSize: theme.fontSize.xs,
                                                color: MODE_STYLES[node.mode]?.color ?? theme.textFaint,
                                                opacity: MODE_STYLES[node.mode]?.muted ? 0.6 : 1,
                                                fontStyle: 'italic',
                                            }}>
                                                [{MODE_LABELS[node.mode] ?? `mode ${node.mode}`}]
                                            </span>
                                        )}
                                    </div>
                                    <NodeId>#{node.id}</NodeId>
                                </NodeHeader>
                                <NodeInputs>
                                    {/* Input connections */}
                                    {node.connections.map((conn) => (
                                        <InputRow key={`conn-${conn.name}`}>
                                            <InputLabel style={{ color: dataTypeColor(conn.type) }}>
                                                {conn.name}
                                            </InputLabel>
                                            <LinkBadge style={{
                                                color: dataTypeColor(conn.type),
                                                borderColor: `${dataTypeColor(conn.type)}40`,
                                                backgroundColor: `${dataTypeColor(conn.type)}12`,
                                            }}>
                                                → {conn.sourceNodeId}[{conn.sourceSlot}]
                                                {conn.type !== '*' && (
                                                    <span style={{ marginLeft: 4, opacity: 0.7, fontSize: '0.9em' }}>
                                                        {dataTypeLabel(conn.type)}
                                                    </span>
                                                )}
                                            </LinkBadge>
                                        </InputRow>
                                    ))}

                                    {/* Widget values */}
                                    {node.widgets.map((widget) => (
                                        <InputRow key={`w${widget.index}`}>
                                            <InputLabel>{getWidgetLabel(node.classType, widget.index)}</InputLabel>
                                            <InputField
                                                type="text"
                                                value={displayValue(widget.value)}
                                                onChange={(e) => updateNodeWidget(node.id, widget.index, e.target.value)}
                                                readOnly={isRunning}
                                                data-testid={`cloud-widget-${node.id}-${widget.index}`}
                                            />
                                        </InputRow>
                                    ))}

                                    {/* Output slots */}
                                    {node.outputs.length > 0 && (
                                        <div style={{
                                            display: 'flex',
                                            flexWrap: 'wrap' as const,
                                            gap: 4,
                                            marginTop: 4,
                                            paddingTop: 4,
                                            borderTop: `1px solid ${theme.border}`,
                                        }}>
                                            <span style={{ fontSize: theme.fontSize.xs, color: theme.textFaint, marginRight: 2 }}>
                                                outputs:
                                            </span>
                                            {node.outputs.map((out) => (
                                                <span
                                                    key={`out-${out.slotIndex}`}
                                                    style={{
                                                        fontSize: theme.fontSize.xs,
                                                        color: dataTypeColor(out.type),
                                                        fontFamily: theme.fontMono,
                                                        padding: '0 4px',
                                                        borderRadius: theme.radiusSm,
                                                        backgroundColor: `${dataTypeColor(out.type)}12`,
                                                        border: `1px solid ${dataTypeColor(out.type)}25`,
                                                    }}
                                                >
                                                    {out.name}
                                                    {out.connectionCount > 0 && (
                                                        <span style={{ opacity: 0.6 }}> ({out.connectionCount})</span>
                                                    )}
                                                    {out.isList && (
                                                        <span style={{ opacity: 0.6 }}> []</span>
                                                    )}
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    {/* Node properties — show S&R name and version if present */}
                                    {(node.properties['Node name for S&R'] || node.properties.ver) && (
                                        <div style={{
                                            display: 'flex',
                                            flexWrap: 'wrap' as const,
                                            gap: 6,
                                            marginTop: 4,
                                            paddingTop: 4,
                                            borderTop: `1px solid ${theme.border}`,
                                        }}>
                                            {node.properties['Node name for S&R'] && (
                                                <span style={{ fontSize: theme.fontSize.xs, color: theme.textDim }}>
                                                    S&amp;R: {node.properties['Node name for S&R']}
                                                </span>
                                            )}
                                            {node.properties.ver && (
                                                <span style={{ fontSize: theme.fontSize.xs, color: theme.textDim }}>
                                                    v{node.properties.ver}
                                                </span>
                                            )}
                                            {node.properties.cnr_id && (
                                                <span style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}>
                                                    CNR: {node.properties.cnr_id}
                                                </span>
                                            )}
                                        </div>
                                    )}

                                    {/* Empty state */}
                                    {node.connections.length === 0 && node.widgets.length === 0 && node.outputs.length === 0 && (
                                        <div style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}>
                                            No inputs
                                        </div>
                                    )}

                                    {/* ── Nested subgraph internal nodes ────────── */}
                                    {isSubgraph && node.subgraphNodes && node.subgraphNodes.length > 0 && (
                                        <div style={{
                                            marginTop: 6,
                                            paddingTop: 6,
                                            borderTop: `1px dashed ${theme.accent}30`,
                                        }}>
                                            <div style={{
                                                fontSize: theme.fontSize.xs,
                                                color: theme.accent,
                                                fontWeight: 600,
                                                marginBottom: 4,
                                            }}>
                                                ◈ {node.subgraphNodes.length} internal node{node.subgraphNodes.length !== 1 ? 's' : ''}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {node.subgraphNodes.map((inner) => (
                                                    <SubgraphNodeCard
                                                        key={inner.id}
                                                        node={inner}
                                                        isRunning={isRunning}
                                                        updateNodeWidget={updateNodeWidget}
                                                    />
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </NodeInputs>
                            </NodeCard>
                            );
                        })}
                    </NodeList>
                </EditorArea>
            )}
        </>
    );

    // ── Footer: action bar ───────────────────────────────────────────

    const footer = (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            {/* Run status */}
            {hasEvents && (
                <Badge style={{ color: run.status === 'error' ? theme.danger : run.status === 'done' ? theme.success : theme.accent }}>
                    {run.status === 'running' && <><SpinnerEl /> Running...</>}
                    {run.status === 'done' && '✓ Done'}
                    {run.status === 'error' && `✗ Error`}
                </Badge>
            )}

            <div style={{ flex: '1 1 auto' }} />

            {pod.status === 'spawning' && (
                <Badge><SpinnerEl /> Spawning...</Badge>
            )}
            {pod.status === 'ready' && (
                <BtnPrimary
                    className="sg-primary"
                    onClick={handleSubmit}
                    disabled={isRunning || nodes.length === 0}
                >
                    {isRunning ? 'Running...' : 'Submit'}
                </BtnPrimary>
            )}
        </div>
    );

    // ── Header ───────────────────────────────────────────────────────

    const header = (
        <>
            <ToggleButton onClick={toggleSidebar} className="sg-hover" aria-label="Toggle sidebar">
                ☰
            </ToggleButton>
            <HeaderTitle>Comfy Dashboard</HeaderTitle>
            {pod.status === 'spawning' && <Badge><SpinnerEl /> Spawning...</Badge>}
            {pod.status === 'ready' && (
                <Badge style={{ marginLeft: 8 }}>
                    <BadgeDot style={{ backgroundColor: theme.success }} />
                    Pod ready
                </Badge>
            )}
            {pod.status === 'error' && (
                <Badge style={{ marginLeft: 8, color: theme.danger }}>
                    <BadgeDot style={{ backgroundColor: theme.danger }} />
                    {pod.message}
                </Badge>
            )}
            {store.loadWarning && (
                <Badge style={{ marginLeft: 8, color: theme.warning, borderColor: theme.warningSoft }}>
                    ⚠ {store.loadWarning}
                </Badge>
            )}
            <div style={{ flex: '1 1 auto' }} />
            {pod.status === 'idle' && (
                <BtnPrimary className="sg-primary" onClick={() => setSpawnDialogOpen(true)}>
                    Spawn Pod
                </BtnPrimary>
            )}
            {pod.status === 'error' && (
                <BtnPrimary className="sg-primary" onClick={() => setSpawnDialogOpen(true)}>
                    Retry
                </BtnPrimary>
            )}
        </>
    );

    // ── Layout ───────────────────────────────────────────────────────

    return (
        <>
            <ComfyDashboard
                sidebarOpen={sidebarOpen}
                onOverlayClick={toggleSidebar}
                headerControls={header}
                sidebar={sidebar}
                content={content}
                footer={footer}
            />

            {/* Spawn Pod dialog */}
            {spawnDialogOpen && (
                <DialogOverlay onClick={() => setSpawnDialogOpen(false)}>
                    <DialogBox onClick={(e) => e.stopPropagation()} data-testid="spawn-dialog">
                        <DialogTitle>Spawn Pod</DialogTitle>
                        <DialogField>
                            <DialogLabel htmlFor="spawn-name">Pod name</DialogLabel>
                            <DialogInput
                                id="spawn-name"
                                type="text"
                                value={podName}
                                onChange={(e) => setPodName(e.target.value)}
                                placeholder="Enter a name for the pod"
                                autoFocus
                                data-testid="spawn-name-input"
                            />
                        </DialogField>
                        <DialogActions>
                            <Btn className="sg-hover" onClick={() => setSpawnDialogOpen(false)}>Cancel</Btn>
                            <BtnPrimary
                                className="sg-primary"
                                onClick={() => {
                                    if (!podName.trim()) return;
                                    setSpawnDialogOpen(false);
                                    handleSpawn(podName.trim());
                                }}
                                disabled={!podName.trim()}
                                data-testid="spawn-confirm-btn"
                            >
                                Spawn
                            </BtnPrimary>
                        </DialogActions>
                    </DialogBox>
                </DialogOverlay>
            )}
        </>
    );
});
