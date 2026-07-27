// CloudTab — Beam cloud workflow runner.
//
// Two-panel layout:
//   Left sidebar: pod execution log / stream results
//   Right content: workflow editor (drop, edit, submit)
//
// Manages all state: workflow nodes, pod lifecycle, prompt execution.

import React from 'react';
import { styled, theme } from '../styles';
import { ComfyDashboard } from './ComfyDashboard';
import { cloudCreate, cloudPrompt, cloudReadNdjson } from '../api/cloud';
import type { CloudStreamEvent } from '../api/cloud';

// ── Types ──────────────────────────────────────────────────────────────

type ComfyNode = {
    id: string;
    class_type: string;
    inputs: Record<string, unknown>;
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

const Btn = styled('button', {
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

const BtnPrimary = styled('button', {
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

const BtnDanger = styled('button', {
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

const Badge = styled('span', {
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

const BadgeDot = styled('span', {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flex: '0 0 auto',
});

const SpinnerEl = styled('span', {
    display: 'inline-block',
    width: 12,
    height: 12,
    border: `2px solid rgba(129, 140, 248, 0.30)`,
    borderTopColor: theme.accent,
    borderRadius: '50%',
    animation: 'sg-spin 700ms linear infinite',
});

const SectionLabel = styled('div', {
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.textDim,
    marginBottom: 6,
});

const ToggleButton = styled('button', {
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

const HeaderTitle = styled('span', {
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.text,
    letterSpacing: 0.2,
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const,
});

// ── Styled: left sidebar (results) ────────────────────────────────────

const SidebarPanel = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden',
});

const SidebarHeader = styled('div', {
    padding: '10px 12px 6px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.textDim,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
    flex: '0 0 auto',
});

const SidebarScroll = styled('div', {
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: '0 12px 12px',
});

const EmptyHint = styled('div', {
    padding: '20px 0',
    fontSize: theme.fontSize.sm,
    color: theme.textFaint,
    textAlign: 'center' as const,
    lineHeight: 1.5,
});

const EventRow = styled('div', {
    padding: '3px 0',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.textDim,
    lineHeight: 1.4,
    borderBottom: `1px solid rgba(255,255,255,0.04)`,
});

const EventOk = styled('div', {
    padding: '3px 0',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.success,
    fontWeight: 600,
    lineHeight: 1.4,
});

const EventErr = styled('div', {
    padding: '3px 0',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.danger,
    fontWeight: 600,
    lineHeight: 1.4,
});

// ── Styled: right content (editor) ────────────────────────────────────

const EditorArea = styled('div', {
    flex: '1 1 auto',
    overflowY: 'auto',
    padding: 14,
});

const EditorAreaEmpty = styled('div', {
    flex: '1 1 auto',
    overflowY: 'auto',
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
    minHeight: 0,
});

const DropTitle = styled('div', {
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.textMuted,
});

const DropHint = styled('div', {
    fontSize: theme.fontSize.sm,
    color: theme.textDim,
});

const NodeList = styled('div', {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
});

const NodeCard = styled('div', {
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface1,
    overflow: 'hidden',
});

const NodeHeader = styled('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    backgroundColor: theme.surface2,
    borderBottom: `1px solid ${theme.border}`,
});

const NodeId = styled('span', {
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    fontFamily: theme.fontMono,
});

const NodeClassType = styled('span', {
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.accent,
});

const NodeInputs = styled('div', {
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
});

const InputRow = styled('div', {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
});

const InputLabel = styled('span', {
    fontSize: theme.fontSize.xs,
    color: theme.textDim,
    fontFamily: theme.fontMono,
    minWidth: 80,
    flex: '0 0 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
});

const InputField = styled('input', {
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

const LinkBadge = styled('span', {
    fontSize: theme.fontSize.xs,
    color: theme.accent2,
    fontFamily: theme.fontMono,
    padding: '1px 5px',
    borderRadius: theme.radiusSm,
    backgroundColor: 'rgba(147, 180, 212, 0.12)',
    border: '1px solid rgba(147, 180, 212, 0.25)',
});

// ── Helpers ────────────────────────────────────────────────────────────

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

            const inputs: Record<string, unknown> = {};
            let widgetIdx = 0;

            for (const desc of inputDescriptors) {
                const name = String(desc.name ?? '');
                const linkId = desc.link != null ? Number(desc.link) : null;

                if (linkId != null && linkMap.has(linkId)) {
                    const [src, slot] = linkMap.get(linkId)!;
                    inputs[name] = [src, slot];
                } else if (name && widgetIdx < widgetValues.length) {
                    inputs[name] = widgetValues[widgetIdx];
                    widgetIdx++;
                }
            }

            const extra = widgetValues.slice(widgetIdx);
            for (let i = 0; i < extra.length; i++) {
                const key = `widget_${i}`;
                if (!(key in inputs)) inputs[key] = extra[i];
            }

            return { id, class_type: classType, inputs };
        });
    }

    // Prompt wrapper: { "prompt": { "3": { "class_type": "...", "inputs": {...} } } }
    if ('prompt' in raw && typeof raw.prompt === 'object' && raw.prompt !== null) {
        const prompt = raw.prompt as Record<string, unknown>;
        const nodes: ComfyNode[] = [];
        for (const [id, value] of Object.entries(prompt)) {
            const node = value as Record<string, unknown>;
            if (node && typeof node === 'object' && 'class_type' in node) {
                nodes.push({
                    id,
                    class_type: String(node.class_type),
                    inputs: (node.inputs as Record<string, unknown>) ?? {},
                });
            }
        }
        if (nodes.length > 0) return nodes;
    }

    // API format: { "3": { "class_type": "...", "inputs": {...} }, ... }
    const nodes: ComfyNode[] = [];
    for (const [id, value] of Object.entries(raw)) {
        if (id === 'extra' || id === 'config' || id === 'groups' || id === 'links' || id === 'version') continue;
        const node = value as Record<string, unknown>;
        if (node && typeof node === 'object' && 'class_type' in node) {
            nodes.push({
                id,
                class_type: String(node.class_type),
                inputs: (node.inputs as Record<string, unknown>) ?? {},
            });
        }
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
    baseUrl = '/api',
}) => {
    const [nodes, setNodes] = React.useState<ComfyNode[]>([]);
    const [rawJson, setRawJson] = React.useState<Record<string, unknown> | null>(null);
    const [fileName, setFileName] = React.useState('');
    const [pod, setPod] = React.useState<PodState>({ status: 'idle' });
    const [run, setRun] = React.useState<RunState>({ status: 'idle' });
    const [dragOver, setDragOver] = React.useState(false);
    const [podName, setPodName] = React.useState('');
    const [sidebarOpen, setSidebarOpen] = React.useState(() => {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia('(min-width: 768px)').matches;
        }
        return true;
    });
    const sidebarScrollRef = React.useRef<HTMLDivElement>(null);
    const fileInputRef = React.useRef<HTMLInputElement>(null);

    const toggleSidebar = React.useCallback(() => setSidebarOpen((prev) => !prev), []);

    // Auto-scroll results sidebar
    React.useEffect(() => {
        if (sidebarScrollRef.current) {
            sidebarScrollRef.current.scrollTop = sidebarScrollRef.current.scrollHeight;
        }
    }, [run]);

    // ── File handling ────────────────────────────────────────────────

    const handleFile = React.useCallback((file: File) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const parsed = JSON.parse(reader.result as string) as Record<string, unknown>;
                setRawJson(parsed);
                setNodes(parseWorkflowJson(parsed));
                setFileName(file.name);
                setPod({ status: 'idle' });
                setRun({ status: 'idle' });
            } catch {
                alert('Invalid JSON file');
            }
        };
        reader.readAsText(file);
    }, []);

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

    const handleFileInput = React.useCallback(() => {
        fileInputRef.current?.click();
    }, []);

    const handleFileInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFile(file);
        e.target.value = '';
    }, [handleFile]);

    const handlePaste = React.useCallback(() => {
        const text = window.prompt('Paste ComfyUI JSON:');
        if (text) {
            try {
                const parsed = JSON.parse(text) as Record<string, unknown>;
                setRawJson(parsed);
                setNodes(parseWorkflowJson(parsed));
                setFileName('pasted.json');
                setPod({ status: 'idle' });
                setRun({ status: 'idle' });
            } catch {
                alert('Invalid JSON');
            }
        }
    }, []);

    // ── Node editing ─────────────────────────────────────────────────

    const updateNodeInput = React.useCallback((nodeId: string, inputKey: string, rawValue: string) => {
        setNodes((prev) =>
            prev.map((n) => {
                if (n.id !== nodeId) return n;
                const original = n.inputs[inputKey];
                if (isLinkRef(original)) return n;
                return {
                    ...n,
                    inputs: { ...n.inputs, [inputKey]: parseInputValue(rawValue, original) },
                };
            })
        );
    }, []);

    // ── Build API prompt ─────────────────────────────────────────────

    const buildPrompt = React.useCallback((): Record<string, unknown> => {
        const prompt: Record<string, unknown> = {};
        for (const node of nodes) {
            prompt[node.id] = {
                class_type: node.class_type,
                inputs: { ...node.inputs },
            };
        }
        return prompt;
    }, [nodes]);

    // ── Pod spawning ─────────────────────────────────────────────────

    const handleSpawn = React.useCallback(async () => {
        setPod({ status: 'spawning' });
        try {
            const result = await cloudCreate(baseUrl, { name: podName || undefined });
            setPod({ status: 'ready', container_id: result.container_id, pod_url: result.pod_url });
        } catch (err: any) {
            setPod({ status: 'error', message: err.message ?? String(err) });
        }
    }, [baseUrl, podName]);

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
    }, []);

    // ── Derived ──────────────────────────────────────────────────────

    const isRunning = run.status === 'running';
    const hasEvents = 'events' in run && run.events.length > 0;

    // Pod status badge for header
    const podStatusBadge = (() => {
        if (pod.status === 'spawning') {
            return <Badge><SpinnerEl /> Spawning...</Badge>;
        }
        if (pod.status === 'ready') {
            return (
                <Badge style={{ marginLeft: 8 }}>
                    <BadgeDot style={{ backgroundColor: theme.success }} />
                    Pod ready
                </Badge>
            );
        }
        if (pod.status === 'error') {
            return (
                <Badge style={{ marginLeft: 8, color: theme.danger }}>
                    <BadgeDot style={{ backgroundColor: theme.danger }} />
                    {pod.message}
                </Badge>
            );
        }
        return null;
    })();

    // ── Sidebar: results panel ───────────────────────────────────────

    const sidebar = (
        <SidebarPanel>
            <SidebarHeader>Results</SidebarHeader>
            <SidebarScroll ref={sidebarScrollRef} className="sg-scroll">
                {!hasEvents && run.status === 'idle' && (
                    <EmptyHint>
                        Spawn a pod and submit a workflow to see execution results here.
                    </EmptyHint>
                )}
                {hasEvents && run.events.map((ev: CloudStreamEvent, i: number) => {
                    if (ev.type === 'execution_success' || ev.type === 'proxy_done') {
                        return <EventOk key={i}>{eventSummary(ev)}</EventOk>;
                    }
                    if (ev.type === 'execution_error' || ev.type === 'proxy_error' || ev.type === 'execution_interrupted') {
                        return <EventErr key={i}>{eventSummary(ev)}</EventErr>;
                    }
                    return <EventRow key={i}>{eventSummary(ev)}</EventRow>;
                })}
                {isRunning && (
                    <EventRow style={{ color: theme.accent }}>
                        <SpinnerEl /> Waiting for events...
                    </EventRow>
                )}
                {run.status === 'done' && (
                    <EventOk>✓ Stream complete</EventOk>
                )}
                {run.status === 'error' && (
                    <EventErr>✗ {run.message}</EventErr>
                )}
            </SidebarScroll>
        </SidebarPanel>
    );

    // ── Content: workflow editor ─────────────────────────────────────

    const content = (
        <>
            {/* Hidden file input */}
            <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
            />

            {/* Empty state: entire area is the drop zone */}
            {nodes.length === 0 && (
                <EditorAreaEmpty
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={handleFileInput}
                    style={dragOver ? { borderColor: theme.accent, backgroundColor: theme.accentSoft } : undefined}
                    data-testid="cloud-drop-zone"
                >
                    <DropTitle>Drop ComfyUI JSON</DropTitle>
                    <DropHint>
                        Drag & drop a .json file, or click to browse.
                    </DropHint>
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
                                style={{ borderColor: theme.accent, backgroundColor: theme.accentSoft, minHeight: 80, margin: 0, padding: 16 }}
                            >
                                <DropTitle style={{ fontSize: theme.fontSize.body }}>Drop to replace workflow</DropTitle>
                            </EditorAreaEmpty>
                        )}
                        <SectionLabel>Workflow Nodes ({nodes.length})</SectionLabel>
                        {nodes.map((node) => (
                            <NodeCard key={node.id} data-testid={`cloud-node-${node.id}`}>
                                <NodeHeader>
                                    <NodeClassType>{node.class_type}</NodeClassType>
                                    <NodeId>#{node.id}</NodeId>
                                </NodeHeader>
                                <NodeInputs>
                                    {Object.entries(node.inputs).map(([key, val]) => {
                                        if (isLinkRef(val)) {
                                            return (
                                                <InputRow key={key}>
                                                    <InputLabel>{key}</InputLabel>
                                                    <LinkBadge>→ node {val[0]}[{val[1]}]</LinkBadge>
                                                </InputRow>
                                            );
                                        }
                                        return (
                                            <InputRow key={key}>
                                                <InputLabel>{key}</InputLabel>
                                                <InputField
                                                    type="text"
                                                    value={displayValue(val)}
                                                    onChange={(e) => updateNodeInput(node.id, key, e.target.value)}
                                                    readOnly={isRunning}
                                                    data-testid={`cloud-input-${node.id}-${key}`}
                                                />
                                            </InputRow>
                                        );
                                    })}
                                    {Object.keys(node.inputs).length === 0 && (
                                        <div style={{ fontSize: theme.fontSize.xs, color: theme.textFaint }}>
                                            No editable inputs
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
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Btn className="sg-hover" onClick={handleFileInput}>Load JSON</Btn>
            <Btn className="sg-hover" onClick={handlePaste}>Paste JSON</Btn>
            {nodes.length > 0 && (
                <BtnDanger className="sg-danger" onClick={handleClear}>Clear</BtnDanger>
            )}
            {fileName && (
                <Badge>{fileName} ({nodes.length} nodes)</Badge>
            )}

            <div style={{ flex: '1 1 auto' }} />

            {pod.status === 'idle' && (
                <>
                    <input
                        type="text"
                        value={podName}
                        onChange={(e) => setPodName(e.target.value)}
                        placeholder="Pod name"
                        style={{
                            padding: '3px 8px',
                            fontSize: theme.fontSize.xs,
                            fontFamily: theme.fontMono,
                            color: theme.text,
                            backgroundColor: theme.surface3,
                            border: `1px solid ${theme.border}`,
                            borderRadius: theme.radiusSm,
                            outline: 'none',
                            width: 110,
                        }}
                    />
                    <BtnPrimary className="sg-primary" onClick={handleSpawn}>Spawn Pod</BtnPrimary>
                </>
            )}
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
            {pod.status === 'error' && (
                <Btn className="sg-hover" onClick={handleSpawn}>Retry</Btn>
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
        </>
    );

    // ── Layout ───────────────────────────────────────────────────────

    return (
        <ComfyDashboard
            sidebarOpen={sidebarOpen}
            onOverlayClick={toggleSidebar}
            headerControls={header}
            sidebar={sidebar}
            content={content}
            footer={footer}
        />
    );
});
