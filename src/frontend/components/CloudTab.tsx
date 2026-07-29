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
import type { CloudStreamEvent, CloudPodStatusResult, WorkflowMeta, GenerationResultItem } from '../api';
import { cloud, cloudPrompt, cloudReadNdjson } from '../api';
import { useDashboardStore } from '../context';
import type {
    ApiPromptNode,
    ComfyLink,
    ComfyLinkTuple,
    DataType,
    NodeInput,
    NodeOutput,
    SubgraphDefinition,
    WorkflowNode
} from '../../comfy';
import { comfyNodeRegistry, getWidgetLabel, isApiLinkRef } from '../../comfy';
import type { UIInputConnection, UINode, UIOutputSlot, UIWidget } from '../nodes/node-type';
import { MODE_LABELS, MODE_STYLES } from '../nodes/node-type';

type PodEntry = {
    id: string;
    podNumber: number;
    name: string;
    pod_url: string;
    status: 'spawning' | 'ready' | 'error';
    /**
     * Consecutive heartbeat failures. Reset to 0 on every successful probe.
     * The pod (and its "Pod#N" button) is removed once this reaches
     * MAX_POD_FAILURES — i.e. when the pod_url has stopped working.
     */
    failCount: number;
    run: RunState;
    /**
     * Generations currently processed server-side for this pod. A pod is
     * never blocked — every Pod#N click queues another job. The
     * generations polling effect prunes this list and settles run.status
     * (done/error) once nothing is left in flight.
     */
    activeGenerationIds: string[];
    health?: CloudPodStatusResult;
    error?: string;
};

type RunState =
    | { status: 'idle' }
    | { status: 'running'; events: CloudStreamEvent[] }
    | { status: 'done'; events: CloudStreamEvent[] }
    | { status: 'error'; events: CloudStreamEvent[]; message: string };

/** Approximate byte size of a base64 payload (accounts for padding). */
function base64ByteSize(b64: string): number {
    const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/**
 * Convert a data: URL into a fresh object URL for viewing.
 * The caller owns the returned URL and MUST revokeObjectURL it when done.
 * Returns null for non-data URLs or undecodable payloads.
 */
function dataUrlToBlobUrl(dataUrl: string): string | null {
    if (!dataUrl.startsWith('data:')) return null;
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return null;
    try {
        const meta = dataUrl.substring(0, commaIdx);
        const b64 = dataUrl.substring(commaIdx + 1);
        const mime = /^data:(.*?);/.exec(meta)?.[1] ?? 'image/png';
        const byteChars = atob(b64);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
            byteArray[i] = byteChars.charCodeAt(i);
        }
        return URL.createObjectURL(new Blob([byteArray], { type: mime }));
    } catch {
        return null;
    }
}

/** Maximum number of workflow items to display in the sidebar. */
const MAX_SIDEBAR_ITEMS = 10;

/** Heartbeat probe interval — keeps pods warm and detects dead pod_urls. */
const POD_HEARTBEAT_MS = 30_000;

/** Consecutive heartbeat failures before a dead pod removes itself. */
const MAX_POD_FAILURES = 2;

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
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`
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
    transition: `background-color ${theme.transition}`
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
    transition: `background-color ${theme.transition}, color ${theme.transition}`
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
    border: `1px solid ${theme.border}`
});

const BadgeDot = styled('span')({
    width: 6,
    height: 6,
    borderRadius: '50%',
    flex: '0 0 auto'
});

const SpinnerEl = styled('span')({
    display: 'inline-block',
    width: 12,
    height: 12,
    border: `2px solid rgba(129, 140, 248, 0.30)`,
    borderTopColor: theme.accent,
    borderRadius: '50%',
    animation: 'sg-spin 700ms linear infinite'
});

const SectionLabel = styled('div')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.textDim,
    marginBottom: 6
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
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`
});

const HeaderTitle = styled('span')({
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.text,
    letterSpacing: 0.2,
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const
});

const SpawnAgentBtn = styled('button')({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    flex: '0 0 auto',
    borderRadius: theme.radiusMd,
    border: `1px solid ${theme.accent}`,
    backgroundColor: theme.accent,
    color: '#ffffff',
    cursor: 'pointer',
    fontSize: theme.fontSize.xl,
    lineHeight: 1,
    padding: 0,
    fontWeight: 600,
    transition: `background-color ${theme.transition}, opacity ${theme.transition}`,
    '&:disabled': {
        opacity: 0.5,
        cursor: 'not-allowed'
    }
});

// ── Styled: left sidebar (workflow list) ─────────────────────────────

const SidebarPanel = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden'
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
    justifyContent: 'space-between'
});

const SidebarSearch = styled('div')({
    padding: '0 12px 8px',
    flex: '0 0 auto'
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
    transition: `border-color ${theme.transition}`
});

const SidebarScroll = styled('div')({
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: '0 6px 12px'
});

const EmptyHint = styled('div')({
    padding: '20px 0',
    fontSize: theme.fontSize.sm,
    color: theme.textFaint,
    textAlign: 'center' as const,
    lineHeight: 1.5
});

const WorkflowItem = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 10px',
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`,
    border: `1px solid transparent`,
    marginBottom: 2
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
    backgroundColor: theme.accentSoft
});

const WorkflowItemName = styled('div')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const
});

const WorkflowItemCount = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.accent2,
    fontWeight: 400
});

const SidebarCount = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    fontWeight: 400
});

// ── Styled: generation list ─────────────────────────────────────────

const QueueItemEl = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 10px',
    borderRadius: theme.radiusMd,
    border: `1px solid ${theme.border}`,
    marginBottom: 4,
    backgroundColor: theme.surface2
});

const QueueItemHeader = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4
});

const QueueItemName = styled('div')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: '1 1 auto',
    minWidth: 0
});

const QueueItemMeta = styled('div')({
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
});

const QueueStatusBadge = styled('span')({
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: theme.fontSize.xs,
    padding: '1px 6px',
    borderRadius: theme.radiusSm,
    fontWeight: 600,
    flex: '0 0 auto'
});

// ── Styled: right content (editor) ────────────────────────────────────

const EditorArea = styled('div')({
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: '14px 24px'
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
    flex: '1 1 auto'
});

const DropTitle = styled('div')({
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.textMuted
});

const DropHint = styled('div')({
    fontSize: theme.fontSize.sm,
    color: theme.textDim
});

const NodeList = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    gap: 8
});

const NodeCard = styled('div')({
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface1,
    overflow: 'hidden'
});

const NodeHeader = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    backgroundColor: theme.surface2,
    borderBottom: `1px solid ${theme.border}`
});

const NodeId = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    fontFamily: theme.fontMono
});

const NodeClassType = styled('span')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.accent
});

const NodeInputs = styled('div')({
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4
});

const InputRow = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
});

const InputLabel = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.textDim,
    fontFamily: theme.fontMono,
    minWidth: 80,
    flex: '0 0 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const
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
    minWidth: 0
});

const LinkBadge = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.accent2,
    fontFamily: theme.fontMono,
    padding: '1px 5px',
    borderRadius: theme.radiusSm,
    backgroundColor: 'rgba(147, 180, 212, 0.12)',
    border: '1px solid rgba(147, 180, 212, 0.25)'
});

// ── SubgraphNodeCard — renders a UINode with the same card as regular nodes ─

const SubgraphNodeCard: React.FC<{
    node: UINode;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    executingNodeId?: string | null;
}> = React.memo(({ node, updateNodeWidget, executingNodeId }) => {
    const isSubgraph = !!node.subgraphDef;
    const registryEntry = comfyNodeRegistry[node.classType];
    const isUnregistered = !isSubgraph && !registryEntry;
    const isExecuting = node.id === executingNodeId;
    return (
        <NodeCard
            style={
                isExecuting
                    ? {
                          marginLeft: 8,
                          border: `2px solid ${theme.accent}`,
                          backgroundColor: theme.accentSoft,
                          boxShadow: `0 0 12px rgba(129, 140, 248, 0.35)`
                      }
                    : isUnregistered
                      ? { marginLeft: 8, border: `1px solid ${theme.dangerBorder}`, backgroundColor: theme.dangerSoft }
                      : { marginLeft: 8, borderLeft: `2px solid ${theme.accent}30` }
            }
        >
            <NodeHeader
                style={
                    isExecuting
                        ? { backgroundColor: 'rgba(129, 140, 248, 0.25)' }
                        : isUnregistered
                          ? { backgroundColor: 'rgba(248, 113, 113, 0.20)' }
                          : undefined
                }
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    {isExecuting && (
                        <span
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: theme.accent,
                                marginRight: 2
                            }}
                            title="Currently executing"
                        >
                            ▶
                        </span>
                    )}
                    <NodeClassType
                        style={
                            isExecuting
                                ? { color: theme.accent }
                                : isUnregistered
                                  ? { color: theme.danger }
                                  : undefined
                        }
                    >
                        {registryEntry?.displayName ?? node.classType}
                    </NodeClassType>
                    {isUnregistered && (
                        <span
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: theme.danger,
                                border: `1px solid ${theme.dangerBorder}`,
                                borderRadius: theme.radiusSm,
                                padding: '0 4px',
                                backgroundColor: theme.dangerSoft
                            }}
                        >
                            not registered
                        </span>
                    )}
                    {node.mode !== 0 && (
                        <span
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: MODE_STYLES[node.mode]?.color ?? theme.textFaint,
                                opacity: MODE_STYLES[node.mode]?.muted ? 0.6 : 1,
                                fontStyle: 'italic'
                            }}
                        >
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
                        <LinkBadge
                            style={{
                                color: dataTypeColor(conn.type),
                                borderColor: `${dataTypeColor(conn.type)}40`,
                                backgroundColor: `${dataTypeColor(conn.type)}12`
                            }}
                        >
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
                            readOnly={false}
                        />
                    </InputRow>
                ))}
                {node.outputs.length > 0 && (
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap' as const,
                            gap: 4,
                            marginTop: 4,
                            paddingTop: 4,
                            borderTop: `1px solid ${theme.border}`
                        }}
                    >
                        <span
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: theme.textFaint,
                                marginRight: 2
                            }}
                        >
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
                                    border: `1px solid ${dataTypeColor(out.type)}25`
                                }}
                            >
                                {out.name}
                                {out.connectionCount > 0 && (
                                    <span style={{ opacity: 0.6 }}> ({out.connectionCount})</span>
                                )}
                                {out.isList && <span style={{ opacity: 0.6 }}> []</span>}
                            </span>
                        ))}
                    </div>
                )}
                {(node.properties['Node name for S&R'] || node.properties.ver) && (
                    <div
                        style={{
                            display: 'flex',
                            flexWrap: 'wrap' as const,
                            gap: 6,
                            marginTop: 4,
                            paddingTop: 4,
                            borderTop: `1px solid ${theme.border}`
                        }}
                    >
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
                        <div
                            style={{
                                fontSize: theme.fontSize.xs,
                                color: theme.accent,
                                fontWeight: 600,
                                marginBottom: 4
                            }}
                        >
                            ◈ {node.subgraphNodes.length} internal node{node.subgraphNodes.length !== 1 ? 's' : ''}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {node.subgraphNodes.map((inner) => (
                                <SubgraphNodeCard
                                    key={inner.id}
                                    node={inner}
                                    updateNodeWidget={updateNodeWidget}
                                    executingNodeId={executingNodeId}
                                />
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
function findSubgraphDef(raw: Record<string, unknown>, subgraphId: string): SubgraphDefinition | undefined {
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
function buildBoundaryLinks(linkTuples: ComfyLinkTuple[], v1Links: ComfyLink[]): BoundaryLink[] {
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
function parseNodesRecursive(
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
                        sourceSlot: rewritten ? rewritten.sourceSlot : Number(link.origin_slot),
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
function buildLinkMapFromTuples(links: ComfyLinkTuple[]): Map<
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
function buildLinkMapFromObjects(links: ComfyLink[]): Map<
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
function buildOutputSlots(node: WorkflowNode): UIOutputSlot[] {
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
                linkId
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

/**
 * Sort nodes into ComfyUI execution order — the order ComfyUI processes the
 * graph, first to last (a node never executes before its inputs are ready).
 *
 * This mirrors how ComfyUI itself orders execution:
 *
 *   - Frontend: `LGraph.computeExecutionOrder()` (@comfyorg/litegraph.js,
 *     src/LGraph.ts) performs Kahn's algorithm (BFS): seed a FIFO queue with
 *     every node that has no incoming links (in graph order), then repeatedly
 *     emit the queue head and push each downstream node whose remaining links
 *     reach zero. The resulting index is written to each node's `order`
 *     field and serialized into the workflow JSON.
 *
 *   - Backend: `ExecutionList` (comfy_execution/graph.py) runs the same
 *     dependency dissolve at runtime: a node is "ready" once all upstream
 *     dependencies have executed, and execution walks the ready set —
 *     dependencies always execute before their dependents. Only nodes that
 *     are ancestors of an output node are scheduled at all.
 *
 * Algorithm (Kahn's / BFS over the link graph):
 *   1. Seed a FIFO queue with every node that has no incoming links,
 *      in workflow-array order (LiteGraph iterates the graph's node array).
 *   2. Emit the queue head, then decrement the remaining-link count of every
 *      node it feeds — visiting links in output-slot order, then link-id order
 *      (link ids increase in creation order), like LiteGraph. A downstream
 *      node whose count reaches zero is appended to the queue.
 *   3. Any leftovers (dependency cycles — invalid workflows that the ComfyUI
 *      backend rejects with DependencyCycleError) are appended last in
 *      original array order, exactly as LiteGraph does.
 *
 * Nodes with no links at all (neither incoming nor outgoing) are discarded:
 * ComfyUI never executes them, since they are not ancestors of an output node.
 *
 * Each returned node's `order` field is rewritten to its computed execution
 * index so downstream consumers see truthful ordering metadata.
 */
function sortNodes(nodes: UINode[]): UINode[] {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const nodeById = new Map(nodes.map((n): [string, UINode] => [n.id, n]));

    // Remaining incoming links per node, and outgoing links per source.
    // Counts are per-link (not per-source-node): a source feeding the same
    // target through two inputs blocks it twice, exactly like LiteGraph.
    const remainingLinks = new Map<string, number>();
    const outlinks = new Map<string, { targetId: string; sourceSlot: number; linkId: number }[]>();

    for (const n of nodes) {
        remainingLinks.set(n.id, 0);
        outlinks.set(n.id, []);
    }

    for (const n of nodes) {
        for (const conn of n.connections) {
            // Ignore links to nodes outside this set (e.g. subgraph internals
            // referencing external nodes — those data are already available).
            if (!nodeIds.has(conn.sourceNodeId)) continue;
            remainingLinks.set(n.id, remainingLinks.get(n.id)! + 1);
            outlinks.get(conn.sourceNodeId)!.push({
                targetId: n.id,
                sourceSlot: conn.sourceSlot,
                linkId: conn.linkId ?? 0
            });
        }
    }

    // Visit each node's outgoing links in LiteGraph's order:
    // output slot order, then link id within the slot.
    for (const links of outlinks.values()) {
        links.sort((a, b) => a.sourceSlot - b.sourceSlot || a.linkId - b.linkId);
    }

    // Seed the FIFO queue with zero-input nodes in the original array order.
    const queue: string[] = [];
    for (const n of nodes) {
        const incoming = remainingLinks.get(n.id)!;
        const outgoing = outlinks.get(n.id)!.length;
        if (incoming === 0 && outgoing === 0) continue; // unlinked — never executes
        if (incoming === 0) queue.push(n.id);
    }

    const result: UINode[] = [];
    const emitted = new Set<string>();
    let head = 0;
    while (head < queue.length) {
        const id = queue[head++];
        if (emitted.has(id)) continue;
        emitted.add(id);
        result.push({ ...nodeById.get(id)!, order: result.length });
        for (const link of outlinks.get(id)!) {
            if (emitted.has(link.targetId)) continue;
            const remaining = remainingLinks.get(link.targetId)! - 1;
            remainingLinks.set(link.targetId, remaining);
            if (remaining === 0) queue.push(link.targetId);
        }
    }

    // Leftovers (dependency cycles) go last in original array order, as LiteGraph does.
    for (const n of nodes) {
        if (!emitted.has(n.id) && remainingLinks.get(n.id)! > 0) {
            result.push({ ...n, order: result.length });
        }
    }

    return result;
}

/**
 * Sort a node tree into ComfyUI execution order, recursing into each
 * subgraph's internal nodes (which form their own dependency graphs).
 */
export function sortNodesDeep(nodes: UINode[]): UINode[] {
    return sortNodes(nodes).map((n) =>
        n.subgraphNodes && n.subgraphNodes.length > 0
            ? { ...n, subgraphNodes: sortNodesDeep(n.subgraphNodes) }
            : n
    );
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
 *
 * `externalIdMap` must include ALL IDs visible from this nesting level that are
 * NOT internal to this subgraph: parent-sibling nodes (from every enclosing
 * subgraph) AND top-level nodes. This is essential so that boundary links
 * rewritten from the -10 sentinel to a top-level node (e.g. "74") can still be
 * renumbered to the top-level prompt ID (e.g. "4") at any depth.
 */
function renumberSubgraphNodes(
    internalNodes: UINode[],
    parentPrefix: string,
    externalIdMap: Map<string, string>
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
        // Recursively renumber deeper subgraph nesting levels.
        // Pass a merged map so nested subgraphs can resolve both their parent's
        // internal siblings (internalIdMap) AND any out-of-subgraph references
        // the parent already knew about (externalIdMap) — including top-level IDs.
        const myNewId = internalIdMap.get(n.id)!;
        const combinedExternalMap = new Map<string, string>([
            ...externalIdMap.entries(),
            ...internalIdMap.entries(),
        ]);
        const subgraphNodes =
            n.subgraphNodes && n.subgraphNodes.length > 0
                ? renumberSubgraphNodes(n.subgraphNodes, myNewId, combinedExternalMap)
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
        case 'MODEL':
            return '#818cf8'; // accent (indigo)
        case 'CLIP':
            return '#a78bfa'; // purple
        case 'VAE':
            return '#f472b6'; // pink
        case 'CONDITIONING':
            return '#6ee7b7'; // success (green)
        case 'LATENT':
            return '#fbbf24'; // warning (amber)
        case 'IMAGE':
            return '#38bdf8'; // sky blue
        case 'MASK':
            return '#fb923c'; // orange
        case 'STRING':
            return '#c8cdd8'; // text muted
        case 'INT':
            return '#93b4d4'; // accent2
        case 'FLOAT':
            return '#93b4d4';
        case 'BOOLEAN':
            return '#f87171'; // danger (red)
        default:
            return '#8891a5'; // textDim
    }
}

/** Short label for a data type. Truncate long type names. */
function dataTypeLabel(type: DataType): string {
    if (typeof type === 'string') return type;
    if (Array.isArray(type)) return type.join('|');
    return String(type);
}

/** Format an ISO timestamp as a relative time string (e.g. "2m ago"). */
function formatRelativeTime(isoString: string | null): string {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'just now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
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

/**
 * Assemble a flat API prompt from a list of already-flattened UI nodes.
 *
 * Widget values are emitted first (keyed by their registry name, or by the
 * inferred name for unregistered nodes), then linked connections override
 * them — so a widget that has been converted to a connected input slot
 * sends the link reference, not the stale widget value. A converted
 * widget whose connection was removed (e.g. an unconnected subgraph
 * input port whose -10 sentinel was filtered out) falls back to its
 * widget value, which is the correct ComfyUI behaviour.
 */
function uiNodesToApiPrompt(flat: UINode[]): Record<string, unknown> {
    const prompt: Record<string, unknown> = {};
    for (const node of flat) {
        const inputs: Record<string, unknown> = {};

        const registryEntry = comfyNodeRegistry[node.classType];

        // ── Widget values (emitted first; connections override below) ──
        for (const widget of node.widgets) {
            const regWidget = registryEntry?.widgets[widget.index];
            if (regWidget) {
                inputs[regWidget.name] = widget.value;
            } else if (widget.inferredName) {
                // Unregistered node — use the name inferred from the
                // workflow's converted-to-input slots or Record-style
                // widgets_values keys.
                inputs[widget.inferredName] = widget.value;
            }
            // Registered nodes with undefined registry widgets (e.g.
            // TemporaryImagePreview's hidden internal widget) are
            // intentionally skipped — they have no API input.
        }

        // ── Linked connections → [sourceNodeId, sourceSlot] ──
        // Processed AFTER widgets so a connected converted-widget input
        // overrides the (stale) widget value.
        for (const conn of node.connections) {
            inputs[conn.name] = [conn.sourceNodeId, conn.sourceSlot];
        }

        prompt[node.id] = { class_type: node.classType, inputs };
    }
    return prompt;
}

/**
 * Convert a ComfyUI workflow JSON (v0.4 or v1 format) into the flat API
 * prompt format expected by POST /prompt.
 *
 * Workflow format has `nodes`, `links`, `groups`, `definitions`, etc.
 * API prompt format is a flat dict keyed by node ID:
 *   { "3": { "class_type": "KSampler", "inputs": { "seed": ..., "model": ["4", 0] } } }
 *
 * If the input is already in API prompt format, it is returned as-is.
 */
export function workflowToApiPrompt(raw: Record<string, unknown>): Record<string, unknown> {
    // Already in API prompt format (flat dict of {class_type, inputs})?
    if (!Array.isArray(raw.nodes)) {
        return raw;
    }

    const uiNodes = parseWorkflowJson(raw);
    const sorted = sortNodesDeep(uiNodes);
    const renumbered = renumberNodes(sorted);

    // Flatten subgraph nodes into their internal nodes.
    // Subgraph wrapper nodes have a subgraphDef but no real ComfyUI class_type —
    // ComfyUI only understands the internal nodes (VAEDecode, KSampler, etc.).
    return uiNodesToApiPrompt(flattenSubgraphNodes(renumbered));
}

/**
 * Build the API prompt from the CURRENT editor node tree — every widget
 * edit the user made is included. This is the source of truth for
 * Generate: what you see in the UI is exactly what gets snapshotted into
 * the generation json and submitted to the pod.
 */
function editorTreeToApiPrompt(nodes: UINode[]): Record<string, unknown> {
    return uiNodesToApiPrompt(flattenSubgraphNodes(nodes));
}

/**
 * Recursively flatten subgraph nodes into a flat list of real ComfyUI nodes.
 *
 * Subgraph wrapper nodes (those with `subgraphDef`) are containers — they
 * have no class_type that ComfyUI recognizes. Their internal nodes (stored
 * in `subgraphNodes`) are the real nodes that need to be in the prompt.
 * Internal nodes may themselves be subgraphs (nested), so we recurse.
 *
 * Nodes without subgraphDef pass through as-is.
 *
 * When a subgraph wrapper is removed, we must:
 *   1. Remap connections that reference the wrapper's outputs to the internal
 *      node that actually produces each output (via the -20 outputNode sentinel).
 *   2. Remove connections referencing sentinel nodes (-10, -20) since those are
 *      virtual nodes that don't exist in the flat prompt.
 */
function flattenSubgraphNodes(nodes: UINode[]): UINode[] {
    // ── First pass: remove wrappers and build output remap tables ─────────
    //
    // For each removed wrapper, we map each of its output slots to the
    // internal renumbered node ID and output slot that produces the data.
    //
    // In subgraph definitions, links TO the -20 sentinel (outputNode) tell us
    // which internal node produces each subgraph output. The subgraph
    // definition's outputs[].linkIds reference these links.
    const outputRemaps = new Map<string, Map<number, { nodeId: string; slot: number }>>();
    const result: UINode[] = [];

    for (const node of nodes) {
        if (node.subgraphDef && node.subgraphNodes && node.subgraphNodes.length > 0) {
            // Build output port → internal producer mapping
            const outputMap = new Map<number, { nodeId: string; slot: number }>();
            const subgraphLinks = node.subgraphLinks ?? [];
            const sgDef = node.subgraphDef;

            // Build a mapping from original internal node IDs → renumbered IDs.
            // After renumberSubgraphNodes, each internal node's _raw.id holds
            // the original ID and its .id holds the renumbered ID (e.g. "2-1").
            const origToRenumbered = new Map<string, string>();
            for (const internalNode of node.subgraphNodes) {
                const origId = internalNode._raw?.id;
                if (origId != null) {
                    origToRenumbered.set(String(origId), internalNode.id);
                }
            }

            for (const sgOutput of sgDef.outputs ?? []) {
                for (const linkId of sgOutput.linkIds ?? []) {
                    // Find the internal link that goes TO the -20 outputNode
                    const link = subgraphLinks.find(
                        (l) => l.id === linkId && String(l.target_id) === '-20'
                    );
                    if (link) {
                        const origSourceId = String(link.origin_id);
                        const renumberedSourceId = origToRenumbered.get(origSourceId);
                        if (renumberedSourceId) {
                            outputMap.set(Number(link.target_slot), {
                                nodeId: renumberedSourceId,
                                slot: Number(link.origin_slot),
                            });
                        }
                    }
                }
            }

            if (outputMap.size > 0) {
                outputRemaps.set(node.id, outputMap);
            }

            // Recursively flatten internal nodes (handles nested subgraphs)
            result.push(...flattenSubgraphNodes(node.subgraphNodes));
        } else {
            result.push(node);
        }
    }

    // ── Second pass: rewire connections referencing removed wrappers ──────
    //
    // Any connection whose sourceNodeId points to a removed subgraph wrapper
    // needs to be redirected to the internal node that produces that output.
    // Connections referencing sentinel nodes (-10, -20) are removed since
    // those virtual nodes don't exist in the flat prompt.
    for (const node of result) {
        node.connections = node.connections
            // Remove sentinel references (-10 = inputNode, -20 = outputNode)
            .filter((conn) => conn.sourceNodeId !== '-10' && conn.sourceNodeId !== '-20')
            .map((conn) => {
                const remap = outputRemaps.get(conn.sourceNodeId);
                if (remap) {
                    const target = remap.get(conn.sourceSlot);
                    if (target) {
                        return { ...conn, sourceNodeId: target.nodeId, sourceSlot: target.slot };
                    }
                }
                return conn;
            });
    }

    return result;
}

// ── Component ──────────────────────────────────────────────────────────

export type CloudTabProps = {
    baseUrl?: string;
};

export const CloudTab: React.FC<CloudTabProps> = React.memo(({ baseUrl = 'http://192.168.8.128:5000/v1/comfy' }) => {
    const {
        store,
        createWorkflow,
        updateWorkflow,
        deleteWorkflow,
        cloneWorkflow,
        selectWorkflow,
        searchWorkflows,
        refreshGenerations,
        generateWorkflow,
        updateGeneration
    } = useDashboardStore();

    const [nodes, setNodes] = React.useState<UINode[]>([]);
    const [rawJson, setRawJson] = React.useState<Record<string, unknown> | null>(null);
    const [fileName, setFileName] = React.useState('');
    const [pods, setPods] = React.useState<PodEntry[]>([]);
    const [dragOver, setDragOver] = React.useState(false);
    const [sidebarOpen, setSidebarOpen] = React.useState(() => {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(min-width: 768px)').matches;
        }
        return true;
    });
    const [searchText, setSearchText] = React.useState(store.searchQuery);
    const [renameOpen, setRenameOpen] = React.useState(false);
    const [renameValue, setRenameValue] = React.useState('');
    const [agentRunning, setAgentRunning] = React.useState(false);
    const [executingNodeId, setExecutingNodeId] = React.useState<string | null>(null);
    const [agentCount, setAgentCount] = React.useState(0);
    const [viewerOpen, setViewerOpen] = React.useState(false);
    const [viewerItems, setViewerItems] = React.useState<GenerationResultItem[]>([]);
    const [viewerIndex, setViewerIndex] = React.useState(0);

    // ── Viewer blob lifecycle ───────────────────────────────────────
    // Generation results persist data: URLs in the server-side json.
    // Blob URLs are generated fresh each time the viewer opens (cheap,
    // avoids re-rendering megabytes of base64 through React) and revoked
    // when it closes — blobs are view-time only, never persisted.

    const viewerBlobUrlsRef = React.useRef<string[]>([]);

    const revokeViewerBlobs = React.useCallback(() => {
        for (const url of viewerBlobUrlsRef.current) {
            URL.revokeObjectURL(url);
        }
        viewerBlobUrlsRef.current = [];
    }, []);

    const openViewer = React.useCallback(
        (items: GenerationResultItem[], index = 0) => {
            revokeViewerBlobs(); // free blobs from any previously viewed generation
            const mapped = items.map((item) => {
                if (!item.url.startsWith('data:')) return item;
                const blobUrl = dataUrlToBlobUrl(item.url);
                if (!blobUrl) return item; // fall back to the raw URL (still renders)
                viewerBlobUrlsRef.current.push(blobUrl);
                return { ...item, url: blobUrl };
            });
            setViewerItems(mapped);
            setViewerIndex(index);
            setViewerOpen(true);
        },
        [revokeViewerBlobs]
    );

    const closeViewer = React.useCallback(() => {
        setViewerOpen(false);
        revokeViewerBlobs();
    }, [revokeViewerBlobs]);

    // Revoke any outstanding viewer blobs when the component unmounts.
    React.useEffect(() => revokeViewerBlobs, [revokeViewerBlobs]);

    const sidebarScrollRef = React.useRef<HTMLDivElement>(null);
    const searchDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    // Monotonic counter for naming generation pods ("Pod#1", "Pod#2", …)
    const podCounterRef = React.useRef(0);

    const toggleSidebar = React.useCallback(() => setSidebarOpen((prev) => !prev), []);

    // Determine if we're editing a saved workflow (loaded from sidebar)
    const editingWorkflowId = store.selectedId;
    const isEditingSaved = editingWorkflowId !== null && rawJson !== null;

    // Auto-scroll results sidebar
    React.useEffect(() => {
        if (sidebarScrollRef.current) {
            sidebarScrollRef.current.scrollTop = sidebarScrollRef.current.scrollHeight;
        }
    }, [pods]);

    // Poll generations for the selected workflow
    React.useEffect(() => {
        if (!editingWorkflowId) return;
        refreshGenerations(editingWorkflowId);
        const interval = setInterval(() => {
            refreshGenerations(editingWorkflowId);
        }, 5000);
        return () => clearInterval(interval);
    }, [editingWorkflowId, refreshGenerations]);

    // ── Sync pod buttons from polled generations ────────────────────
    // Pod processing lives on the server; polling the generation list is
    // what settles each "Pod#N" button's state. A pod can have several
    // jobs in flight — it stays "running" until the LAST one settles,
    // then shows done (all succeeded) or error (any failed).

    React.useEffect(() => {
        setPods((prev) => {
            let changed = false;
            const next = prev.map((p): PodEntry => {
                if (p.activeGenerationIds.length === 0) return p;

                const stillActive: string[] = [];
                const settled: typeof store.generations = [];
                for (const genId of p.activeGenerationIds) {
                    const gen = store.generations.find((g) => g.id === genId);
                    if (!gen || gen.status === 'pending' || gen.status === 'processing') {
                        stillActive.push(genId);
                    } else {
                        settled.push(gen);
                    }
                }
                if (settled.length === 0) return p;
                changed = true;

                // Some jobs still running — prune the settled ones, keep spinning
                if (stillActive.length > 0) {
                    return { ...p, activeGenerationIds: stillActive };
                }
                // Last job settled — pod goes done, or error if any failed
                const failed = settled.find((g) => g.status === 'failed');
                const run: RunState = failed
                    ? { status: 'error', events: [], message: failed.error ?? 'Generation failed' }
                    : { status: 'done', events: [] };
                return { ...p, activeGenerationIds: stillActive, run };
            });
            return changed ? next : prev;
        });
    }, [store.generations]);

    // Debounced search
    const handleSearchChange = React.useCallback(
        (value: string) => {
            setSearchText(value);
            if (searchDebounceRef.current) {
                clearTimeout(searchDebounceRef.current);
            }
            searchDebounceRef.current = setTimeout(() => {
                searchWorkflows(value);
            }, 300);
        },
        [searchWorkflows]
    );

    // ── Load a saved workflow from sidebar ───────────────────────────

    const handleLoadWorkflow = React.useCallback(
        (wf: WorkflowMeta) => {
            selectWorkflow(wf.id);
            // We need to fetch full workflow to get raw JSON
            // selectWorkflow already loads the full workflow into store.selectedWorkflow
        },
        [selectWorkflow]
    );

    // When selectedWorkflow changes, parse its raw JSON into nodes.
    //
    // Pods are intentionally NOT reset here: a pod is an independent Beam
    // cloud instance — switching workflows must not destroy it. The pod
    // buttons (and their monotonic pod-number counter) persist across
    // workflow loads, so a pod spawned while editing one workflow can be
    // reused to queue a generation on any other workflow.
    React.useEffect(() => {
        const full = store.selectedWorkflow;
        if (full && full.raw) {
            setRawJson(full.raw);
            setNodes(renumberNodes(sortNodesDeep(parseWorkflowJson(full.raw))));
            setFileName(`${full.name}.json`);
        }
    }, [store.selectedWorkflow]);

    // ── Auto-save workflow on drop ──────────────────────────────────

    const autoSaveWorkflow = React.useCallback(
        async (raw: Record<string, unknown>, name: string) => {
            try {
                const created = await createWorkflow({
                    name,
                    raw
                });
                selectWorkflow(created.id);
            } catch (err: any) {
                alert(`Failed to auto-save: ${err.message ?? String(err)}`);
            }
        },
        [createWorkflow, selectWorkflow]
    );

    // ── File handling ────────────────────────────────────────────────

    const handleFile = React.useCallback(
        (file: File) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const parsed = JSON.parse(reader.result as string) as Record<string, unknown>;
                    setRawJson(parsed);
                    setNodes(renumberNodes(sortNodesDeep(parseWorkflowJson(parsed))));
                    const name = file.name.replace(/\.json$/i, '') || 'Untitled Workflow';
                    setFileName(file.name);
                    // Auto-save the workflow with the filename as the name.
                    // Pods are independent of workflows — do not reset them.
                    autoSaveWorkflow(parsed, name);
                } catch {
                    alert('Invalid JSON file');
                }
            };
            reader.readAsText(file);
        },
        [autoSaveWorkflow]
    );

    const handleDrop = React.useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) handleFile(file);
        },
        [handleFile]
    );

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

    // ── Build API prompt from the current editor tree ────────────────
    // The editor tree (with all widget edits) is the source of truth —
    // see editorTreeToApiPrompt(). Prompt construction for Generate no
    // longer reads the stored workflow json.

    // ── Copy JSON to clipboard ───────────────────────────────────────

    // ── Copy JSON to clipboard ───────────────────────────────────────

    const handleCopyJson = React.useCallback(async () => {
        if (!rawJson) return;
        const text = JSON.stringify(rawJson, null, 2);
        try {
            // Try modern Clipboard API first (requires secure context: HTTPS or localhost)
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return;
            }
        } catch {
            // Fall through to legacy approach
        }
        // Fallback: temporary textarea + execCommand (works over plain HTTP)
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
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
            // Clear editor. Pods are independent Beam cloud instances —
            // deleting a workflow must not destroy them; they remain usable
            // with whichever workflow is loaded next.
            setNodes([]);
            setRawJson(null);
            setFileName('');
        } catch (err: any) {
            alert(`Failed to delete: ${err.message ?? String(err)}`);
        }
    }, [editingWorkflowId, deleteWorkflow]);

    // ── Rename workflow ────────────────────────────────────────────

    const openRename = React.useCallback(() => {
        if (!editingWorkflowId || !store.selectedWorkflow) return;
        setRenameValue(store.selectedWorkflow.name);
        setRenameOpen(true);
    }, [editingWorkflowId, store.selectedWorkflow]);

    const submitRename = React.useCallback(async () => {
        if (!editingWorkflowId) return;
        const trimmed = renameValue.trim();
        if (!trimmed) return;
        try {
            await updateWorkflow(editingWorkflowId, { name: trimmed });
            setRenameOpen(false);
        } catch (err: any) {
            alert(`Failed to rename: ${err.message ?? String(err)}`);
        }
    }, [editingWorkflowId, renameValue, updateWorkflow]);

    // ── Run a generation on a cloud pod ────────────────────────────
    // Shared by "Generate" (spawns a fresh pod) and "Pod#N" (reuses a pod).
    //
    // 1. Builds the API prompt from the CURRENT editor tree — every
    //    widget edit is included (the stored workflow json is NOT read).
    // 2. Snapshots that prompt via the workflow generation API (same
    //    place as before: POST /v1/comfy/workflows/:id/generate, with the
    //    prompt in the request body) — edited == stored == executed.
    // 3. Submits the snapshot to POST /v1/comfy/cloud/prompt with the
    //    pod_url + workflow/generation ids. The SERVER consumes the pod's
    //    NDJSON stream and updates the generation json by itself — this
    //    call returns immediately (202).
    // 4. Client-side we are done: the continuous generations polling
    //    updates the sidebar with progress, and settles the pod button's
    //    running → done/error state (see the sync effect below).

    const runGenerationOnPod = React.useCallback(
        async (podUrl: string, podId?: string) => {
            if (nodes.length === 0 || !editingWorkflowId) return;

            // Step 1+2 — build the prompt from the live editor tree and
            // snapshot it into a generation json.
            const apiPrompt = editorTreeToApiPrompt(nodes);
            const generation = await generateWorkflow(editingWorkflowId, apiPrompt);
            console.log(`[Generate] Created generation ${generation.id} — submitting to ${podUrl}`);

            try {
                // Step 3 — submit and be done. The server processes the
                // pod stream in the background from here (scoped to this
                // job via a per-submission client_id).
                await cloudPrompt(baseUrl, {
                    pod_url: podUrl,
                    prompt: generation.prompt,
                    workflow_id: editingWorkflowId,
                    generation_id: generation.id,
                    extra_data: {
                        workflow_id: editingWorkflowId,
                        generation_id: generation.id
                    }
                });
                // Accepted — add to the pod's in-flight set; polling
                // settles each entry. Pods accept concurrent jobs, so an
                // existing run does not block this one.
                if (podId) {
                    setPods((prev) =>
                        prev.map((p) =>
                            p.id === podId
                                ? {
                                      ...p,
                                      run: { status: 'running', events: [] },
                                      activeGenerationIds: [...p.activeGenerationIds, generation.id]
                                  }
                                : p
                        )
                    );
                }
            } catch (err: any) {
                const message = err.message ?? String(err);
                // Submission itself failed — only surface an error on the
                // button when nothing else is still running on this pod.
                if (podId) {
                    setPods((prev) =>
                        prev.map((p) =>
                            p.id === podId && p.activeGenerationIds.length === 0
                                ? { ...p, run: { status: 'error', events: [], message } }
                                : p
                        )
                    );
                }
                throw err;
            }
        },
        [baseUrl, nodes, editingWorkflowId, generateWorkflow]
    );

    // ── Generate workflow ──────────────────────────────────────────
    // Creates a cloud pod first, then runs a new generation snapshot on it
    // via POST /v1/comfy/cloud/prompt. The "Pod#N" button appears
    // IMMEDIATELY on click — in "spawning" state (spinner) while the
    // pod_url is being resolved — then flips to ready. Clicking a ready
    // Pod#N does the same thing but reuses that pod (skipping pod creation).
    //
    // Generate is NEVER blocked: every click spawns a fresh pod, as fast
    // as the user can click. Per-pod status (spawning, running, done/error)
    // lives on the individual "Pod#N" button, not on Generate.

    const handleGenerate = React.useCallback(async () => {
        if (nodes.length === 0 || !editingWorkflowId) return;

        // Step 1 — register the pod entry immediately so the "Pod#N"
        // button shows up while the pod_url is still being resolved.
        podCounterRef.current += 1;
        const podNumber = podCounterRef.current;
            const podEntry: PodEntry = {
                id: `gen-pod-${Date.now()}-${podNumber}`,
                podNumber,
                name: `Pod#${podNumber}`,
                pod_url: '',
                status: 'spawning',
                failCount: 0,
                activeGenerationIds: [],
                run: { status: 'idle' }
            };
        setPods((prev) => [...prev, podEntry]);

        // Step 2 — create the cloud pod
        console.log(`[Generate] Spawning Pod#${podNumber}...`);
        let podUrl: string;
        try {
            const result = await cloud(baseUrl, { type: 'create' });
            if (!('pod_url' in result)) {
                throw new Error('Pod spawn response did not contain pod_url');
            }
            podUrl = (result as { pod_url: string }).pod_url;
        } catch (err: any) {
            // Spawn failed — no pod_url ever existed; remove the button.
            setPods((prev) => prev.filter((p) => p.id !== podEntry.id));
            alert(`Failed to spawn Pod#${podNumber}: ${err.message ?? String(err)}`);
            return;
        }
        console.log(`[Generate] Pod#${podNumber} spawned: ${podUrl}`);

        // Step 3 — pod_url exists: the pod is now usable
        setPods((prev) =>
            prev.map((p) =>
                p.id === podEntry.id ? { ...p, pod_url: podUrl, status: 'ready', failCount: 0 } : p
            )
        );

        // Step 4 — snapshot + submit for server-side processing.
        // A failure here keeps the pod — its button shows the run error
        // and stays reusable.
        try {
            await runGenerationOnPod(podUrl, podEntry.id);
        } catch (err: any) {
            alert(`Failed to generate: ${err.message ?? String(err)}`);
        }
    }, [nodes.length, editingWorkflowId, baseUrl, runGenerationOnPod]);

    // ── Pod#N: same as Generate but reuses an existing pod_url ──────
    // NEVER blocked while running: each click queues ANOTHER job on the
    // pod. The server scopes each submission with its own client_id and
    // filters the shared pod stream by prompt_id, so every generation
    // json only receives its own job's events.

    const handlePodGenerate = React.useCallback(
        async (pod: PodEntry) => {
            if (nodes.length === 0 || !editingWorkflowId) return;
            if (!pod.pod_url || pod.status !== 'ready') return;
            try {
                console.log(`[Pod#${pod.podNumber}] Queueing job on ${pod.pod_url}`);
                await runGenerationOnPod(pod.pod_url, pod.id);
            } catch (err: any) {
                alert(`Failed to generate: ${err.message ?? String(err)}`);
            }
        },
        [nodes.length, editingWorkflowId, runGenerationOnPod]
    );

    // ── Spawn agent: create a cloud pod and run all pending generations ──
    //
    // 1. Calls POST /v1/comfy/cloud with {} to spawn a new pod.
    // 2. Filters generations with status "pending" only.
    // 3. Marks picked-up generations as "processing" so other agents skip them.
    // 4. Streams the NDJSON response back, collecting image results.
    // 5. PUTs the results back to the server when done.

    const handleSpawnAgent = React.useCallback(async () => {
        if (agentRunning) return;

        // Only pick up "pending" generations — not "processing" or completed ones
        const pendingGenerations = store.generations.filter((g) => g.status === 'pending');
        if (pendingGenerations.length === 0) {
            console.log('[Agent] No pending generations to process. Click "Generate" first to create a snapshot.');
            return;
        }

        setAgentRunning(true);
        setAgentCount((c) => c + 1);
        const totalStart = performance.now();
        console.log(`[Agent] Spawning cloud pod... (${pendingGenerations.length} pending generations)`);

        // Immediately mark all pending generations as "processing"
        if (editingWorkflowId) {
            for (const gen of pendingGenerations) {
                try {
                    await updateGeneration(editingWorkflowId, gen.id, { status: 'processing' });
                } catch (err: any) {
                    console.warn(`[Agent] Failed to mark generation ${gen.id} as processing:`, err.message);
                }
            }
            // Refresh the list after marking
            await refreshGenerations(editingWorkflowId);
        }

        try {
            // Step 1 — spawn the pod
            const spawnStart = performance.now();
            const result = await cloud(baseUrl, { type: 'create' });
            const spawnMs = performance.now() - spawnStart;
            if (!('pod_url' in result)) {
                console.error('[Agent] Spawn response did not contain pod_url', result);
                setAgentRunning(false);
                return;
            }
            const podUrl = (result as { pod_url: string }).pod_url;
            console.log(`[Agent] Pod spawned in ${(spawnMs / 1000).toFixed(1)}s: ${podUrl}`);

            // Step 2 — iterate generations and submit each prompt
            for (let i = 0; i < pendingGenerations.length; i++) {
                const gen = pendingGenerations[i];
                const genStart = performance.now();
                const collectedResults: GenerationResultItem[] = [];
                console.log(`[Agent] (${i + 1}/${pendingGenerations.length}) Submitting generation ${gen.id}...`);
                console.log(`[Agent] Prompt payload:`, JSON.stringify(gen.prompt, null, 2));

                try {
                    const apiPrompt = workflowToApiPrompt(gen.prompt);
                    console.log(`[Agent] Converted API prompt:`, JSON.stringify(apiPrompt, null, 2));

                    const response = await cloudPrompt(baseUrl, {
                        pod_url: podUrl,
                        prompt: apiPrompt
                    });

                    // Step 3 — stream NDJSON and log each event
                    let executionStartMs: number | null = null;
                    for await (const event of cloudReadNdjson(response)) {
                        const now = performance.now();
                        const elapsed = ((now - genStart) / 1000).toFixed(1);
                        console.log(`[Agent] Event (${gen.id}):`, event.type, event.data, ` [+${elapsed}s]`);

                        // Track currently executing node for visual highlighting
                        if (event.type === 'executing') {
                            const nodeId = (event.data as any)?.node;
                            setExecutingNodeId(nodeId ?? null);
                        }

                        // Capture execution_start timestamp
                        if (event.type === 'execution_start') {
                            executionStartMs = now;
                        }

                        // Capture imagepreview.update — store the data URL as-is.
                        // (blob: URLs die with the page and MUST NOT be persisted
                        // in the generation json; data URLs survive, and the viewer
                        // converts them to throwaway blob URLs on open.)
                        if (event.type === 'imagepreview.update') {
                            const imageData = (event.data as any)?.image as string | undefined;
                            const imageNodeId = (event.data as any)?.node_id as string | undefined;
                            if (imageData && imageData.startsWith('data:')) {
                                const commaIdx = imageData.indexOf(',');
                                if (commaIdx !== -1) {
                                    const meta = imageData.substring(0, commaIdx);
                                    const b64 = imageData.substring(commaIdx + 1);
                                    const mimeMatch = meta.match(/^data:(.*?);/);
                                    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
                                    console.log(
                                        `[Agent] Image from node ${imageNodeId}:`,
                                        `MIME: ${mime}`,
                                        `Size: ${base64ByteSize(b64)} bytes`
                                    );
                                    collectedResults.push({
                                        type: 'image',
                                        url: imageData,
                                        mimeType: mime,
                                        size: base64ByteSize(b64),
                                        nodeId: imageNodeId ?? ''
                                    });
                                }
                            }
                        }

                        // Terminal events — stop reading this stream
                        if (
                            event.type === 'proxy_done' ||
                            event.type === 'execution_error' ||
                            event.type === 'proxy_error'
                        ) {
                            const genMs = performance.now() - genStart;
                            const execMs = executionStartMs != null ? performance.now() - executionStartMs : null;
                            const execStr = execMs != null ? `, execution: ${(execMs / 1000).toFixed(1)}s` : '';
                            console.log(
                                `[Agent] Generation ${gen.id} finished (${event.type}) — ` +
                                `total: ${(genMs / 1000).toFixed(1)}s${execStr}`
                            );
                            break;
                        }
                    }
                    // Clear executing node highlight when generation completes
                    setExecutingNodeId(null);

                    // Step 4 — PUT results back to the server
                    if (editingWorkflowId) {
                        const genFinishTime = new Date().toISOString();
                        const genTotalMs = performance.now() - genStart;
                        try {
                            await updateGeneration(editingWorkflowId, gen.id, {
                                status: 'completed',
                                result: collectedResults,
                                generatedTime: `${(genTotalMs / 1000).toFixed(1)}s`,
                                completedDate: genFinishTime
                            });
                            console.log(`[Agent] PUT generation ${gen.id}: completed with ${collectedResults.length} result(s)`);
                        } catch (err: any) {
                            console.error(`[Agent] Failed to PUT generation ${gen.id}:`, err.message);
                        }
                    }
                } catch (err: any) {
                    const genMs = performance.now() - genStart;
                    console.error(`[Agent] Failed to submit generation ${gen.id} after ${(genMs / 1000).toFixed(1)}s:`, err.message ?? String(err));
                    // Mark as failed
                    if (editingWorkflowId) {
                        try {
                            await updateGeneration(editingWorkflowId, gen.id, {
                                status: 'failed',
                                error: err.message ?? String(err)
                            });
                        } catch { /* ignore */ }
                    }
                }
            }

            const totalMs = performance.now() - totalStart;
            console.log(`[Agent] All generations processed — total wall time: ${(totalMs / 1000).toFixed(1)}s`);
        } catch (err: any) {
            const totalMs = performance.now() - totalStart;
            console.error(`[Agent] Spawn failed after ${(totalMs / 1000).toFixed(1)}s:`, err.message ?? String(err));
        } finally {
            setAgentRunning(false);
            // Refresh generations to reflect updated statuses
            if (editingWorkflowId) {
                refreshGenerations(editingWorkflowId);
            }
        }
    }, [agentRunning, baseUrl, store.generations, editingWorkflowId, updateGeneration, refreshGenerations]);

    // ── Keepalive heartbeat ─────────────────────────────────────────
    // Pods scale to zero ~120s after the last active connection, so probing
    // periodically both resets that idle timer AND detects dead pods.
    //
    // Every probe resets the pod's strike counter on success. A failure
    // (pod unreachable, or health.healthy === false) records a strike:
    // the first strike marks the pod as error (button disabled, stays
    // visible in case it recovers); once strikes reach MAX_POD_FAILURES
    // the pod's pod_url is considered dead and the pod is removed
    // entirely — its "Pod#N" button and badge disappear.
    //
    // Skips the tick if the previous one is still in flight (cold start).

    const podsRef = React.useRef(pods);
    podsRef.current = pods;

    // Record a failed heartbeat probe for a pod. Reads the freshest entry
    // from state so concurrent success/reset can't clobber the count.
    const strikePod = React.useCallback((podId: string, message: string) => {
        setPods((prev) => {
            const current = prev.find((ep) => ep.id === podId);
            if (!current) return prev;
            const failCount = current.failCount + 1;
            if (failCount >= MAX_POD_FAILURES) {
                console.warn(
                    `[Heartbeat] Pod#${current.podNumber} removed — pod_url stopped working ` +
                    `(${failCount} consecutive probe failures, last: ${message})`
                );
                return prev.filter((ep) => ep.id !== podId);
            }
            console.warn(
                `[Heartbeat] Pod#${current.podNumber} probe failed (${failCount}/${MAX_POD_FAILURES}): ${message}`
            );
            return prev.map((ep) =>
                ep.id === podId ? { ...ep, status: 'error', failCount, error: message } : ep
            );
        });
    }, []);

    React.useEffect(() => {
        let running = false;
        const interval = setInterval(async () => {
            if (running) return; // previous tick still in flight — skip
            running = true;
            try {
                const currentPods = podsRef.current;
                for (const p of currentPods) {
                    // Probe ready AND previously-failed pods so they can
                    // either recover or accumulate the final strike.
                    if (p.status === 'spawning' || !p.pod_url) continue;
                    try {
                        const result = await cloud(baseUrl, { type: 'status', pod_url: p.pod_url });
                        const statusResult = result as CloudPodStatusResult;
                        const healthy =
                            'health' in result ? statusResult.health?.healthy !== false : true;
                        if (healthy) {
                            // Alive — clear strikes, refresh health, mark ready
                            setPods((prev) =>
                                prev.map((ep) =>
                                    ep.id === p.id
                                        ? {
                                              ...ep,
                                              status: 'ready',
                                              failCount: 0,
                                              error: undefined,
                                              health: statusResult
                                          }
                                        : ep
                                )
                            );
                        } else {
                            strikePod(p.id, statusResult.health?.error ?? 'pod reported unhealthy');
                        }
                    } catch (err: any) {
                        strikePod(p.id, err.message ?? String(err));
                    }
                }
            } finally {
                running = false;
            }
        }, POD_HEARTBEAT_MS);
        return () => clearInterval(interval);
    }, [baseUrl, strikePod]);

    // ── Sidebar: workflow list panel ────────────────────────────────

    const displayedWorkflows = React.useMemo(() => {
        return store.workflows.slice(0, MAX_SIDEBAR_ITEMS);
    }, [store.workflows]);

    const sidebar = (
        <SidebarPanel>
            <SidebarHeader>
                <span>
                    Workflows <SidebarCount>({store.workflows.length})</SidebarCount>
                </span>
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
                {displayedWorkflows.map((wf) => {
                    const isActive = wf.id === editingWorkflowId;
                    const Item = isActive ? WorkflowItemActive : WorkflowItem;
                    return (
                        <Item
                            key={wf.id}
                            onClick={() => handleLoadWorkflow(wf)}
                            data-testid={`workflow-item-${wf.id}`}
                            style={isActive ? {} : undefined}
                            className={isActive ? '' : ''}
                        >
                            <WorkflowItemName>{wf.name}</WorkflowItemName>
                        </Item>
                    );
                })}
                {store.workflows.length > MAX_SIDEBAR_ITEMS && (
                    <EmptyHint style={{ padding: '8px 0' }}>
                        + {store.workflows.length - MAX_SIDEBAR_ITEMS} more...
                    </EmptyHint>
                )}
            </SidebarScroll>

            {/* ── Generations section ──────────────────────── */}
            {isEditingSaved && (
                <>
                    <div style={{ borderTop: `1px solid ${theme.border}`, margin: '0 6px' }} />
                    <SidebarHeader>
                        <span>
                            Generations <SidebarCount>({store.generations.length})</SidebarCount>
                        </span>
                    </SidebarHeader>
                    <div style={{ padding: '0 6px 12px', overflowY: 'auto', flex: '1 1 auto' }}>
                        {store.generations.length === 0 && (
                            <EmptyHint>No generations yet.</EmptyHint>
                        )}
                        {store.generations.map((gen) => {
                            const hasResults = gen.result && gen.result.length > 0;
                            const genStatusColor =
                                gen.status === 'completed'
                                    ? theme.success
                                    : gen.status === 'failed'
                                        ? theme.danger
                                        : gen.status === 'processing'
                                            ? theme.accent
                                            : theme.textDim;
                            const genStatusBg =
                                gen.status === 'completed'
                                    ? theme.successSoft
                                    : gen.status === 'failed'
                                        ? theme.dangerSoft
                                        : gen.status === 'processing'
                                            ? theme.accentSoft
                                            : theme.surface2;
                            return (
                                <QueueItemEl
                                    key={gen.id}
                                    data-testid={`gen-item-${gen.id}`}
                                    style={
                                        hasResults
                                            ? { cursor: 'pointer', transition: `border-color ${theme.transition}` }
                                            : undefined
                                    }
                                    onClick={hasResults ? () => openViewer(gen.result) : undefined}
                                >
                                    <QueueItemHeader>
                                        <QueueItemName title={gen.id}>
                                            {gen.id}
                                        </QueueItemName>
                                        {hasResults && (
                                            <span
                                                style={{
                                                    fontSize: theme.fontSize.xs,
                                                    color: theme.accent,
                                                    flexShrink: 0,
                                                    marginLeft: 4
                                                }}
                                            >
                                                {gen.result.length} item{gen.result.length !== 1 ? 's' : ''}
                                            </span>
                                        )}
                                    </QueueItemHeader>
                                    <QueueItemMeta>
                                        <QueueStatusBadge style={{
                                            color: genStatusColor,
                                            backgroundColor: genStatusBg
                                        }}>
                                            {gen.status === 'processing' && <SpinnerEl />}
                                            {gen.status}
                                        </QueueStatusBadge>
                                        {gen.generatedTime && (
                                            <span style={{ color: theme.accent, fontWeight: 500 }}>
                                                {gen.generatedTime}
                                            </span>
                                        )}
                                        <span title={gen.createdDate}>
                                            {formatRelativeTime(gen.createdDate)}
                                        </span>
                                    </QueueItemMeta>
                                    {gen.error && (
                                        <div style={{
                                            fontSize: theme.fontSize.xs,
                                            color: theme.danger,
                                            marginTop: 4,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap' as const
                                        }} title={gen.error}>
                                            {gen.error}
                                        </div>
                                    )}
                                </QueueItemEl>
                            );
                        })}
                    </div>
                </>
            )}
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
                    <DropHint>Drag & drop a .json file to get started.</DropHint>
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
                                style={{
                                    position: 'relative' as const,
                                    borderColor: theme.accent,
                                    backgroundColor: theme.accentSoft,
                                    minHeight: 80,
                                    margin: 0,
                                    padding: 16,
                                    flex: '0 0 auto'
                                }}
                            >
                                <DropTitle style={{ fontSize: theme.fontSize.body }}>
                                    Drop to replace workflow
                                </DropTitle>
                            </EditorAreaEmpty>
                        )}

                        {/* Workflow name header with Clone/Delete */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8,
                                marginBottom: 10
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                                <SectionLabel style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>
                                    {isEditingSaved && store.selectedWorkflow ? store.selectedWorkflow.name : 'Unsaved'}
                                </SectionLabel>
                                {isEditingSaved && store.selectedWorkflow?.description && (
                                    <span
                                        style={{
                                            fontSize: theme.fontSize.xs,
                                            color: theme.textFaint,
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap' as const
                                        }}
                                    >
                                        {store.selectedWorkflow.description}
                                    </span>
                                )}

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
                            const isExecuting = node.id === executingNodeId;
                            return (
                                <NodeCard
                                    key={node.id}
                                    data-testid={`cloud-node-${node.id}`}
                                    style={
                                        isExecuting
                                            ? {
                                                  border: `2px solid ${theme.accent}`,
                                                  backgroundColor: theme.accentSoft,
                                                  boxShadow: `0 0 12px rgba(129, 140, 248, 0.35)`
                                              }
                                            : isUnregistered
                                              ? {
                                                    border: `1px solid ${theme.dangerBorder}`,
                                                    backgroundColor: theme.dangerSoft
                                                }
                                              : isSubgraph
                                                ? { border: `1px solid ${theme.accent}40` }
                                                : undefined
                                    }
                                >
                                    <NodeHeader
                                        style={{
                                            backgroundColor: isExecuting
                                                ? 'rgba(129, 140, 248, 0.25)'
                                                : node.color
                                                  ? node.color
                                                  : isUnregistered
                                                    ? 'rgba(248, 113, 113, 0.20)'
                                                    : isSubgraph
                                                      ? 'rgba(129, 140, 248, 0.15)'
                                                      : undefined
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                            {isExecuting && (
                                                <span
                                                    style={{
                                                        fontSize: theme.fontSize.xs,
                                                        color: theme.accent,
                                                        marginRight: 2
                                                    }}
                                                    title="Currently executing"
                                                >
                                                    ▶
                                                </span>
                                            )}
                                            {isSubgraph && (
                                                <span
                                                    style={{
                                                        fontSize: theme.fontSize.xs,
                                                        color: theme.accent,
                                                        marginRight: 2
                                                    }}
                                                    title="Subgraph"
                                                >
                                                    ◈
                                                </span>
                                            )}
                                            <NodeClassType
                                                style={
                                                    isSubgraph
                                                        ? { color: theme.accent }
                                                        : isUnregistered
                                                          ? { color: theme.danger }
                                                          : undefined
                                                }
                                            >
                                                {registryEntry?.displayName ?? node.classType}
                                            </NodeClassType>
                                            {isUnregistered && (
                                                <span
                                                    style={{
                                                        fontSize: theme.fontSize.xs,
                                                        color: theme.danger,
                                                        border: `1px solid ${theme.dangerBorder}`,
                                                        borderRadius: theme.radiusSm,
                                                        padding: '0 4px',
                                                        backgroundColor: theme.dangerSoft
                                                    }}
                                                >
                                                    not registered
                                                </span>
                                            )}
                                            {registryEntry?.category && (
                                                <span
                                                    style={{
                                                        fontSize: theme.fontSize.xs,
                                                        color: theme.textFaint,
                                                        fontFamily: theme.fontMono
                                                    }}
                                                >
                                                    {registryEntry.category}
                                                </span>
                                            )}
                                            {node.mode !== 0 && (
                                                <span
                                                    style={{
                                                        fontSize: theme.fontSize.xs,
                                                        color: MODE_STYLES[node.mode]?.color ?? theme.textFaint,
                                                        opacity: MODE_STYLES[node.mode]?.muted ? 0.6 : 1,
                                                        fontStyle: 'italic'
                                                    }}
                                                >
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
                                                <LinkBadge
                                                    style={{
                                                        color: dataTypeColor(conn.type),
                                                        borderColor: `${dataTypeColor(conn.type)}40`,
                                                        backgroundColor: `${dataTypeColor(conn.type)}12`
                                                    }}
                                                >
                                                    → {conn.sourceNodeId}[{conn.sourceSlot}]
                                                    {conn.type !== '*' && (
                                                        <span
                                                            style={{ marginLeft: 4, opacity: 0.7, fontSize: '0.9em' }}
                                                        >
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
                                                    onChange={(e) =>
                                                        updateNodeWidget(node.id, widget.index, e.target.value)
                                                    }
                                                    readOnly={false}
                                                    data-testid={`cloud-widget-${node.id}-${widget.index}`}
                                                />
                                            </InputRow>
                                        ))}

                                        {/* Output slots */}
                                        {node.outputs.length > 0 && (
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    flexWrap: 'wrap' as const,
                                                    gap: 4,
                                                    marginTop: 4,
                                                    paddingTop: 4,
                                                    borderTop: `1px solid ${theme.border}`
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontSize: theme.fontSize.xs,
                                                        color: theme.textFaint,
                                                        marginRight: 2
                                                    }}
                                                >
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
                                                            border: `1px solid ${dataTypeColor(out.type)}25`
                                                        }}
                                                    >
                                                        {out.name}
                                                        {out.connectionCount > 0 && (
                                                            <span style={{ opacity: 0.6 }}>
                                                                {' '}
                                                                ({out.connectionCount})
                                                            </span>
                                                        )}
                                                        {out.isList && <span style={{ opacity: 0.6 }}> []</span>}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {/* Node properties — show S&R name and version if present */}
                                        {(node.properties['Node name for S&R'] || node.properties.ver) && (
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    flexWrap: 'wrap' as const,
                                                    gap: 6,
                                                    marginTop: 4,
                                                    paddingTop: 4,
                                                    borderTop: `1px solid ${theme.border}`
                                                }}
                                            >
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
                                                    <span
                                                        style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}
                                                    >
                                                        CNR: {node.properties.cnr_id}
                                                    </span>
                                                )}
                                            </div>
                                        )}

                                        {/* Empty state */}
                                        {node.connections.length === 0 &&
                                            node.widgets.length === 0 &&
                                            node.outputs.length === 0 && (
                                                <div style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}>
                                                    No inputs
                                                </div>
                                            )}

                                        {/* ── Nested subgraph internal nodes ────────── */}
                                        {isSubgraph && node.subgraphNodes && node.subgraphNodes.length > 0 && (
                                            <div
                                                style={{
                                                    marginTop: 6,
                                                    paddingTop: 6,
                                                    borderTop: `1px dashed ${theme.accent}30`
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        fontSize: theme.fontSize.xs,
                                                        color: theme.accent,
                                                        fontWeight: 600,
                                                        marginBottom: 4
                                                    }}
                                                >
                                                    ◈ {node.subgraphNodes.length} internal node
                                                    {node.subgraphNodes.length !== 1 ? 's' : ''}
                                                </div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                    {node.subgraphNodes.map((inner) => (
                                                        <SubgraphNodeCard
                                                            key={inner.id}
                                                            node={inner}
                                                            updateNodeWidget={updateNodeWidget}
                                                            executingNodeId={executingNodeId}
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
            {/* Pod number badges — color reflects pod + run state */}
            {pods.map((p) => {
                const isPodRunning = p.run.status === 'running';
                const isPodDone = p.run.status === 'done';
                const isPodError = p.run.status === 'error' || p.status === 'error';

                const badgeColor =
                    isPodRunning
                        ? theme.accent
                        : isPodDone
                          ? theme.success
                          : isPodError
                            ? theme.danger
                            : p.status === 'spawning'
                              ? theme.textDim
                              : theme.success;
                const bgColor =
                    isPodRunning
                        ? theme.accentSoft
                        : isPodDone
                          ? theme.successSoft
                          : isPodError
                            ? theme.dangerSoft
                            : p.status === 'spawning'
                              ? theme.surface2
                              : theme.successSoft;

                const label = p.status === 'spawning'
                    ? ''
                    : isPodRunning
                      ? `${p.podNumber}`
                      : isPodDone
                        ? `${p.podNumber}✓`
                        : isPodError
                          ? `${p.podNumber}✗`
                          : String(p.podNumber);

                return (
                    <span
                        key={p.id}
                        title={
                            p.status === 'spawning'
                                ? `Pod ${p.podNumber} — starting up…`
                                : isPodRunning
                                  ? `Pod ${p.podNumber} — processing…`
                                  : isPodDone
                                    ? `Pod ${p.podNumber} — done`
                                    : isPodError
                                      ? `Pod ${p.podNumber} — ${p.run.status === 'error' ? p.run.message : ''} ${p.error || 'error'}`
                                      : `Pod ${p.podNumber} — ready`
                        }
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            minWidth: 28,
                            height: 28,
                            borderRadius: 14,
                            fontSize: theme.fontSize.xs,
                            fontWeight: 600,
                            color: badgeColor,
                            backgroundColor: bgColor,
                            border: `1px solid ${badgeColor}`,
                            flex: '0 0 auto',
                            padding: '0 6px',
                            gap: 3
                        }}
                    >
                        {p.status === 'spawning' ? (
                            <SpinnerEl />
                        ) : (
                            <>
                                {isPodRunning && <SpinnerEl />}
                                {label}
                            </>
                        )}
                    </span>
                );
            })}

            <div style={{ flex: '1 1 auto' }} />

            {/* Pod#N: queue another generation on an existing pod (skips pod
                creation). Appears the moment Generate is clicked (spawning
                spinner while the pod_url resolves). Never disabled while
                running — pods accept concurrent jobs; the in-flight count is
                shown next to the label. Carry their own status: spinner
                while spawning / while jobs are in flight, colored border for
                the last settled result, heartbeat removal when the pod_url
                dies. */}
            {pods.map((p) => {
                const isSpawning = p.status === 'spawning';
                const inFlight = p.activeGenerationIds.length;
                const isDisabled =
                    isSpawning || nodes.length === 0 || !p.pod_url || p.status !== 'ready';
                return (
                    <Btn
                        key={p.id}
                        className="sg-hover"
                        onClick={() => handlePodGenerate(p)}
                        disabled={isDisabled}
                        title={
                            isSpawning
                                ? `Pod#${p.podNumber} — starting up…`
                                : p.status !== 'ready'
                                  ? `Pod#${p.podNumber} — ${p.error || 'unavailable'} ` +
                                    `(heartbeat ${p.failCount}/${MAX_POD_FAILURES}, removed if it keeps failing)`
                                  : inFlight > 0
                                    ? `Pod#${p.podNumber} — ${inFlight} job${inFlight !== 1 ? 's' : ''} ` +
                                      `in flight on ${p.pod_url} — click to queue another`
                                    : `Queue a new generation on ${p.pod_url}`
                        }
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            borderColor:
                                isSpawning || inFlight > 0
                                    ? theme.accent
                                    : p.run.status === 'error'
                                      ? theme.dangerBorder
                                      : p.run.status === 'done'
                                        ? theme.success
                                        : theme.border
                        }}
                        data-testid={`pod-generate-${p.podNumber}`}
                    >
                        {(isSpawning || inFlight > 0) && <SpinnerEl />}
                        Pod#{p.podNumber}
                        {inFlight > 0 && (
                            <span style={{ fontSize: theme.fontSize.xs, color: theme.accent, fontWeight: 600 }}>
                                ×{inFlight}
                            </span>
                        )}
                    </Btn>
                );
            })}

            {/* Generate: spawns a fresh cloud pod, snapshots the workflow, and
                streams the run back via POST /v1/comfy/cloud/prompt.
                Never blocked — every click spawns another pod. */}
            <BtnPrimary
                className="sg-primary"
                onClick={handleGenerate}
                disabled={nodes.length === 0}
                title={
                    nodes.length === 0
                        ? 'Load a workflow first'
                        : 'Spawn a new cloud pod and generate'
                }
            >
                Generate
            </BtnPrimary>
        </div>
    );

    // ── Header ───────────────────────────────────────────────────────

    const header = (
        <>
            <ToggleButton onClick={toggleSidebar} className="sg-hover" aria-label="Toggle sidebar">
                ☰
            </ToggleButton>
            <HeaderTitle
                onClick={isEditingSaved ? openRename : undefined}
                style={isEditingSaved ? { cursor: 'pointer' } : undefined}
            >
                {isEditingSaved && store.selectedWorkflow ? store.selectedWorkflow.name : 'Comfy Dashboard'}
            </HeaderTitle>

            {store.loadWarning && (
                <Badge style={{ marginLeft: 8, color: theme.warning, borderColor: theme.warningSoft }}>
                    ⚠ {store.loadWarning}
                </Badge>
            )}

            <div style={{ flex: '1 1 auto' }} />

            {agentCount > 0 && (
                <Badge
                    style={{
                        marginRight: 6,
                        color: agentRunning ? theme.accent : theme.success,
                        backgroundColor: agentRunning ? theme.accentSoft : theme.successSoft,
                        border: `1px solid ${agentRunning ? theme.accent : theme.success}`,
                        fontWeight: 600,
                        cursor: 'default'
                    }}
                    title={`${agentCount} agent${agentCount !== 1 ? 's' : ''} spawned`}
                >
                    {agentCount}
                </Badge>
            )}

            <SpawnAgentBtn
                className="sg-primary"
                onClick={handleSpawnAgent}
                disabled={agentRunning}
                title={agentRunning ? 'Agent running...' : 'Spawn agent to run generations'}
            >
                {agentRunning ? <SpinnerEl /> : '+'}
            </SpawnAgentBtn>
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

            {/* Rename dialog */}
            {renameOpen && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 1000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(0,0,0,0.5)'
                    }}
                    onClick={() => setRenameOpen(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            backgroundColor: theme.surface2,
                            border: `1px solid ${theme.border}`,
                            borderRadius: theme.radiusLg,
                            padding: 20,
                            minWidth: 320,
                            boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
                        }}
                    >
                        <div style={{ fontSize: theme.fontSize.sm, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
                            Rename Workflow
                        </div>
                        <input
                            type="text"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') submitRename(); }}
                            autoFocus
                            style={{
                                width: '100%',
                                padding: '6px 10px',
                                fontSize: theme.fontSize.sm,
                                borderRadius: theme.radiusMd,
                                border: `1px solid ${theme.border}`,
                                backgroundColor: theme.surface1,
                                color: theme.text,
                                outline: 'none',
                                boxSizing: 'border-box' as const
                            }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                            <Btn onClick={() => setRenameOpen(false)}>Cancel</Btn>
                            <BtnPrimary onClick={submitRename}>Save</BtnPrimary>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Image/Video Viewer Modal ──────────────────────────── */}
            {viewerOpen && viewerItems.length > 0 && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 2000,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: 'rgba(0,0,0,0.85)'
                    }}
                    onClick={closeViewer}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') closeViewer();
                        if (e.key === 'ArrowLeft') setViewerIndex((i) => (i > 0 ? i - 1 : viewerItems.length - 1));
                        if (e.key === 'ArrowRight') setViewerIndex((i) => (i < viewerItems.length - 1 ? i + 1 : 0));
                    }}
                    tabIndex={0}
                    ref={(el) => {
                        if (el) el.focus();
                    }}
                >
                    {/* Left arrow */}
                    {viewerItems.length > 1 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setViewerIndex((i) => (i > 0 ? i - 1 : viewerItems.length - 1));
                            }}
                            style={{
                                position: 'absolute',
                                left: 20,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: 44,
                                height: 44,
                                borderRadius: '50%',
                                border: '1px solid rgba(255,255,255,0.3)',
                                backgroundColor: 'rgba(255,255,255,0.1)',
                                color: '#fff',
                                fontSize: 20,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'background-color 0.15s'
                            }}
                            title="Previous"
                        >
                            ‹
                        </button>
                    )}

                    {/* Content */}
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            maxWidth: '85vw',
                            maxHeight: '85vh',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: 12
                        }}
                    >
                        {viewerItems[viewerIndex]?.type === 'image' ? (
                            <img
                                src={viewerItems[viewerIndex].url}
                                alt={`Result ${viewerIndex + 1}`}
                                style={{
                                    maxWidth: '85vw',
                                    maxHeight: '80vh',
                                    objectFit: 'contain',
                                    borderRadius: theme.radiusMd,
                                    boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
                                }}
                            />
                        ) : viewerItems[viewerIndex]?.type === 'video' ? (
                            <video
                                src={viewerItems[viewerIndex].url}
                                controls
                                autoPlay
                                style={{
                                    maxWidth: '85vw',
                                    maxHeight: '80vh',
                                    borderRadius: theme.radiusMd,
                                    boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
                                }}
                            />
                        ) : null}

                        {/* Info bar */}
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 12,
                                color: 'rgba(255,255,255,0.8)',
                                fontSize: theme.fontSize.sm
                            }}
                        >
                            <span>
                                {viewerIndex + 1} / {viewerItems.length}
                            </span>
                            <span style={{ opacity: 0.5 }}>|</span>
                            <span>{viewerItems[viewerIndex]?.mimeType}</span>
                            <span style={{ opacity: 0.5 }}>|</span>
                            <span>{viewerItems[viewerIndex]?.size ? `${(viewerItems[viewerIndex].size / 1024).toFixed(1)} KB` : ''}</span>
                            <span style={{ opacity: 0.5 }}>|</span>
                            <span>node {viewerItems[viewerIndex]?.nodeId}</span>
                        </div>
                    </div>

                    {/* Right arrow */}
                    {viewerItems.length > 1 && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setViewerIndex((i) => (i < viewerItems.length - 1 ? i + 1 : 0));
                            }}
                            style={{
                                position: 'absolute',
                                right: 20,
                                top: '50%',
                                transform: 'translateY(-50%)',
                                width: 44,
                                height: 44,
                                borderRadius: '50%',
                                border: '1px solid rgba(255,255,255,0.3)',
                                backgroundColor: 'rgba(255,255,255,0.1)',
                                color: '#fff',
                                fontSize: 20,
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'background-color 0.15s'
                            }}
                            title="Next"
                        >
                            ›
                        </button>
                    )}

                    {/* Close hint */}
                    <div
                        style={{
                            position: 'absolute',
                            top: 20,
                            right: 20,
                            color: 'rgba(255,255,255,0.5)',
                            fontSize: theme.fontSize.xs
                        }}
                    >
                        ESC to close · ← → to navigate
                    </div>
                </div>
            )}
        </>
    );
});

