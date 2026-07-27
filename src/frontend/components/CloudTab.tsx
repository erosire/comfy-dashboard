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
import type { CloudStreamEvent } from '../api/cloud';
import type { WorkflowMeta } from '../api';

// ── Types ──────────────────────────────────────────────────────────────

type ComfyNode = {
    id: string;
    class_type: string;
    inputs: Record<string, unknown>;      // linked connection slots: { name: [srcId, slot] }
    widgets: unknown[];                   // widget values (from widgets_values)
};

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

const BtnSuccess = styled('button')({
    padding: '5px 14px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    border: `1px solid rgba(110, 231, 183, 0.35)`,
    backgroundColor: theme.successSoft,
    color: theme.success,
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

const DialogTextArea = styled('textarea')({
    padding: '6px 10px',
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontSans,
    color: theme.text,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    outline: 'none',
    resize: 'vertical' as const,
    minHeight: 60,
    transition: `border-color ${theme.transition}`,
});

const DialogActions = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
});

// ── Helpers ────────────────────────────────────────────────────────────

/** Classify and order nodes: inputs (sources) → middle → outputs (sinks). Discard unlinked. */
function sortNodes(nodes: ComfyNode[]): ComfyNode[] {
    const nodeIds = new Set(nodes.map((n) => n.id));

    // Which nodes does each node receive from? (incoming links)
    // Which nodes does each node feed into? (outgoing references)
    const incomingFrom = new Map<string, Set<string>>();   // node → set of nodes it receives from
    const outgoingTo = new Map<string, Set<string>>();     // node → set of nodes it feeds into

    for (const n of nodes) {
        incomingFrom.set(n.id, new Set());
        outgoingTo.set(n.id, new Set());
    }

    for (const n of nodes) {
        for (const val of Object.values(n.inputs)) {
            if (isLinkRef(val)) {
                const srcId = val[0];
                if (nodeIds.has(srcId)) {
                    incomingFrom.get(n.id)!.add(srcId);
                    outgoingTo.get(srcId)!.add(n.id);
                }
            }
        }
    }

    const isSource = (n: ComfyNode) => incomingFrom.get(n.id)!.size === 0;
    const isSink = (n: ComfyNode) => outgoingTo.get(n.id)!.size === 0;

    const inputs: ComfyNode[] = [];
    const outputs: ComfyNode[] = [];
    const middle: ComfyNode[] = [];

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
function renumberNodes(nodes: ComfyNode[]): ComfyNode[] {
    const idMap = new Map<string, string>();
    nodes.forEach((n, i) => idMap.set(n.id, String(i + 1)));

    return nodes.map((n) => {
        const inputs: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(n.inputs)) {
            if (isLinkRef(val)) {
                const newSrc = idMap.get(val[0]);
                inputs[key] = newSrc != null ? [newSrc, val[1]] : val;
            } else {
                inputs[key] = val;
            }
        }
        return { id: idMap.get(n.id)!, class_type: n.class_type, inputs, widgets: n.widgets };
    });
}

function parseWorkflowJson(raw: Record<string, unknown>): ComfyNode[] {
    // Workflow/UI format: { "nodes": [...], "links": [...] }
    if (Array.isArray(raw.nodes)) {
        const links = Array.isArray(raw.links) ? raw.links as Array<Array<unknown>> : [];
        const linkMap = new Map<number, [string, number]>();
        for (const link of links) {
            if (Array.isArray(link) && link.length >= 4) {
                linkMap.set(Number(link[0]), [String(link[1]), Number(link[2])]);
            }
        }

        return (raw.nodes as Array<Record<string, unknown>>).map((n) => {
            const id = String(n.id ?? '');
            const classType = String(n.type ?? n.class_type ?? 'Unknown');
            const inputDescriptors = Array.isArray(n.inputs) ? n.inputs as Array<Record<string, unknown>> : [];
            const widgetValues = Array.isArray(n.widgets_values) ? n.widgets_values as unknown[] : [];

            // inputs: only store linked connection slots
            const inputs: Record<string, unknown> = {};
            for (const desc of inputDescriptors) {
                const name = String(desc.name ?? '');
                const linkId = desc.link != null ? Number(desc.link) : null;
                if (linkId != null && linkMap.has(linkId)) {
                    const [src, slot] = linkMap.get(linkId)!;
                    inputs[name] = [src, slot];
                }
            }

            return { id, class_type: classType, inputs, widgets: widgetValues };
        });
    }

    // Prompt wrapper: { "prompt": { "3": { "class_type": "...", "inputs": {...} } } }
    // API format: { "3": { "class_type": "...", "inputs": {...} }, ... }
    // In both, inputs dict mixes link refs [srcId, slot] and scalar widget values.
    function parsePromptNode(id: string, node: Record<string, unknown>): ComfyNode | null {
        if (!(node && typeof node === 'object' && 'class_type' in node)) return null;
        const rawInputs = (node.inputs as Record<string, unknown>) ?? {};
        const inputs: Record<string, unknown> = {};
        const widgets: unknown[] = [];
        for (const [key, val] of Object.entries(rawInputs)) {
            if (isLinkRef(val)) {
                inputs[key] = val;
            } else {
                widgets.push(val);
            }
        }
        return { id, class_type: String(node.class_type), inputs, widgets };
    }

    if ('prompt' in raw && typeof raw.prompt === 'object' && raw.prompt !== null) {
        const prompt = raw.prompt as Record<string, unknown>;
        const nodes: ComfyNode[] = [];
        for (const [id, value] of Object.entries(prompt)) {
            const parsed = parsePromptNode(id, value as Record<string, unknown>);
            if (parsed) nodes.push(parsed);
        }
        if (nodes.length > 0) return nodes;
    }

    // API format
    const nodes: ComfyNode[] = [];
    for (const [id, value] of Object.entries(raw)) {
        if (id === 'extra' || id === 'config' || id === 'groups' || id === 'links' || id === 'version') continue;
        const parsed = parsePromptNode(id, value as Record<string, unknown>);
        if (parsed) nodes.push(parsed);
    }
    return nodes;
}

function isLinkRef(val: unknown): val is [string, number] {
    return Array.isArray(val) && val.length === 2 && typeof val[0] === 'string';
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
        updateWorkflow,
        deleteWorkflow,
        cloneWorkflow,
        selectWorkflow,
        searchWorkflows,
        refreshWorkflows,
    } = useDashboardStore();

    const [nodes, setNodes] = React.useState<ComfyNode[]>([]);
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
    const [saveDialogOpen, setSaveDialogOpen] = React.useState(false);
    const [saveName, setSaveName] = React.useState('');
    const [saveDesc, setSaveDesc] = React.useState('');
    const [saving, setSaving] = React.useState(false);
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

    // ── File handling ────────────────────────────────────────────────

    const handleFile = React.useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string) as Record<string, unknown>;
                setRawJson(parsed);
                setNodes(renumberNodes(sortNodes(parseWorkflowJson(parsed))));
                setFileName(file.name);
                setPod({ status: 'idle' });
                setRun({ status: 'idle' });
                // Deselect any saved workflow since this is new unsaved content
                if (editingWorkflowId) {
                    selectWorkflow(null);
                }
            } catch {
                alert('Invalid JSON file');
            }
        };
        reader.readAsText(file);
    }, [editingWorkflowId, selectWorkflow]);

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
        setNodes((prev) =>
            prev.map((n) => {
                if (n.id !== nodeId) return n;
                const widgets = [...n.widgets];
                widgets[widgetIdx] = parseInputValue(rawValue, widgets[widgetIdx]);
                return { ...n, widgets };
            })
        );
    }, []);

    // ── Build API prompt ─────────────────────────────────────────────

    const buildPrompt = React.useCallback((): Record<string, unknown> => {
        const prompt: Record<string, unknown> = {};
        for (const node of nodes) {
            // Merge linked inputs with widget values back into the flat inputs dict
            const inputs: Record<string, unknown> = { ...node.inputs };
            for (let i = 0; i < node.widgets.length; i++) {
                inputs[`widget_${i}`] = node.widgets[i];
            }
            prompt[node.id] = { class_type: node.class_type, inputs };
        }
        return prompt;
    }, [nodes]);

    // Rebuild rawJson from nodes for saving
    const rebuildRawJson = React.useCallback((): Record<string, unknown> => {
        if (rawJson) {
            const prompt: Record<string, unknown> = {};
            for (const node of nodes) {
                const inputs: Record<string, unknown> = { ...node.inputs };
                for (let i = 0; i < node.widgets.length; i++) {
                    inputs[`widget_${i}`] = node.widgets[i];
                }
                prompt[node.id] = { class_type: node.class_type, inputs };
            }
            if ('prompt' in rawJson) {
                return { ...rawJson, prompt };
            }
            return prompt;
        }
        // Fallback
        const prompt: Record<string, unknown> = {};
        for (const node of nodes) {
            const inputs: Record<string, unknown> = { ...node.inputs };
            for (let i = 0; i < node.widgets.length; i++) {
                inputs[`widget_${i}`] = node.widgets[i];
            }
            prompt[node.id] = { class_type: node.class_type, inputs };
        }
        return prompt;
    }, [rawJson, nodes]);

    // ── Save / Update workflow ───────────────────────────────────────

    const handleSaveDialogOpen = React.useCallback(() => {
        if (isEditingSaved && store.selectedWorkflow) {
            // Pre-fill with existing workflow data
            setSaveName(store.selectedWorkflow.name);
            setSaveDesc(store.selectedWorkflow.description ?? '');
        } else {
            // New workflow — suggest name from filename
            const suggestedName = fileName.replace(/\.json$/i, '') || 'Untitled Workflow';
            setSaveName(suggestedName);
            setSaveDesc('');
        }
        setSaveDialogOpen(true);
    }, [isEditingSaved, store.selectedWorkflow, fileName]);

    const handleSaveConfirm = React.useCallback(async () => {
        if (!saveName.trim() || nodes.length === 0) return;
        setSaving(true);
        try {
            const raw = rebuildRawJson();
            if (isEditingSaved && editingWorkflowId) {
                // Update existing
                await updateWorkflow(editingWorkflowId, {
                    name: saveName.trim(),
                    description: saveDesc.trim() || undefined,
                    raw,
                });
            } else {
                // Create new
                const created = await createWorkflow({
                    name: saveName.trim(),
                    description: saveDesc.trim() || undefined,
                    raw,
                });
                // Select the newly created workflow
                selectWorkflow(created.id);
            }
            setSaveDialogOpen(false);
        } catch (err: any) {
            alert(`Failed to save: ${err.message ?? String(err)}`);
        } finally {
            setSaving(false);
        }
    }, [saveName, saveDesc, nodes, rebuildRawJson, isEditingSaved, editingWorkflowId, updateWorkflow, createWorkflow, selectWorkflow]);

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

    const handleClear = React.useCallback(() => {
        setNodes([]);
        setRawJson(null);
        setFileName('');
        setPod({ status: 'idle' });
        setRun({ status: 'idle' });
        selectWorkflow(null);
    }, [selectWorkflow]);

    // ── Derived ──────────────────────────────────────────────────────

    const isRunning = run.status === 'running';
    const hasEvents = 'events' in run && run.events.length > 0;
    const hasUnsavedChanges = nodes.length > 0 && !isEditingSaved;

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
                            <WorkflowItemName>{wf.name} <WorkflowItemCount>({wf.nodeCount} nodes)</WorkflowItemCount></WorkflowItemName>
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
                            {isEditingSaved && (
                                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
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
                                </div>
                            )}
                        </div>
                        {nodes.map((node) => (
                            <NodeCard key={node.id} data-testid={`cloud-node-${node.id}`}>
                                <NodeHeader>
                                    <NodeClassType>{node.class_type}</NodeClassType>
                                    <NodeId>#{node.id}</NodeId>
                                </NodeHeader>
                                <NodeInputs>
                                    {Object.entries(node.inputs).map(([key, val]) => {
                                        const link = val as [string, number];
                                        return (
                                            <InputRow key={key}>
                                                <InputLabel>{key}</InputLabel>
                                                <LinkBadge>→ node {link[0]}[{link[1]}]</LinkBadge>
                                            </InputRow>
                                        );
                                    })}
                                    {node.widgets.map((val, i) => (
                                        <InputRow key={`w${i}`}>
                                            <InputLabel>#{i + 1}</InputLabel>
                                            <InputField
                                                type="text"
                                                value={displayValue(val)}
                                                onChange={(e) => updateNodeWidget(node.id, i, e.target.value)}
                                                readOnly={isRunning}
                                                data-testid={`cloud-widget-${node.id}-${i}`}
                                            />
                                        </InputRow>
                                    ))}
                                    {Object.keys(node.inputs).length === 0 && node.widgets.length === 0 && (
                                        <div style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}>
                                            No inputs
                                        </div>
                                    )}
                                </NodeInputs>
                            </NodeCard>
                        ))}
                    </NodeList>
                </EditorArea>
            )}
        </>
    );

    // ── Footer: action bar ───────────────────────────────────────────

    const footer = (
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const }}>
            {nodes.length > 0 && (
                <>
                    {isEditingSaved ? (
                        <BtnSuccess className="sg-hover" onClick={handleSaveDialogOpen}>
                            Update
                        </BtnSuccess>
                    ) : (
                        <BtnSuccess className="sg-hover" onClick={handleSaveDialogOpen}>
                            Save
                        </BtnSuccess>
                    )}
                </>
            )}
            {nodes.length > 0 && (
                <BtnDanger className="sg-danger" onClick={handleClear}>Clear</BtnDanger>
            )}
            {fileName && (
                <Badge>{fileName} ({nodes.length} nodes)</Badge>
            )}

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
            {hasUnsavedChanges && (
                <Badge style={{ marginLeft: 4, color: theme.warning, borderColor: theme.warningSoft }}>
                    ● Unsaved
                </Badge>
            )}
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

            {/* Save dialog */}
            {saveDialogOpen && (
                <DialogOverlay onClick={() => setSaveDialogOpen(false)}>
                    <DialogBox onClick={(e) => e.stopPropagation()} data-testid="save-dialog">
                        <DialogTitle>
                            {isEditingSaved ? 'Update Workflow' : 'Save Workflow'}
                        </DialogTitle>
                        <DialogField>
                            <DialogLabel htmlFor="save-name">Name</DialogLabel>
                            <DialogInput
                                id="save-name"
                                type="text"
                                value={saveName}
                                onChange={(e) => setSaveName(e.target.value)}
                                placeholder="Workflow name"
                                autoFocus
                                data-testid="save-name-input"
                            />
                        </DialogField>
                        <DialogField>
                            <DialogLabel htmlFor="save-desc">Description (optional)</DialogLabel>
                            <DialogTextArea
                                id="save-desc"
                                value={saveDesc}
                                onChange={(e) => setSaveDesc(e.target.value)}
                                placeholder="Short description..."
                                data-testid="save-desc-input"
                            />
                        </DialogField>
                        <DialogActions>
                            <Btn className="sg-hover" onClick={() => setSaveDialogOpen(false)}>Cancel</Btn>
                            <BtnPrimary
                                className="sg-primary"
                                onClick={handleSaveConfirm}
                                disabled={saving || !saveName.trim()}
                                data-testid="save-confirm-btn"
                            >
                                {saving ? 'Saving...' : isEditingSaved ? 'Update' : 'Save'}
                            </BtnPrimary>
                        </DialogActions>
                    </DialogBox>
                </DialogOverlay>
            )}

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
