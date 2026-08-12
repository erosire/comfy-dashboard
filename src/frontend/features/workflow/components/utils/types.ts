// Shared types for the workflow dashboard feature.
//
// Extracted from the original CloudTab.tsx so both the WorkflowDashboard
// component and its sub-components / hooks can import them from one place.

import type { CloudPodQueueEntry, CloudStreamEvent, GenerationResultMeta } from '../../../../api';
import type { UINode, UIWidget } from '@underload/comfy';

/**
 * A cloud pod mirrored by the dashboard, with its run state and its
 * SERVER-REPORTED queue.
 *
 * Neither liveness nor queue membership is tracked here: the pod buttons
 * purely mirror the server's registry (GET /v1/comfy/cloud — one persistent
 * websocket per pod, each with the server-tracked queue list). A pod the
 * server stops listing has a terminated socket (its reconnect schedule
 * already failed server-side) and its button is removed on the next poll —
// there are no client-side probes, strikes, or error states.
 */
export type PodEntry = {
    id: string;
    podNumber: number;
    name: string;
    /**
     * Empty ONLY while the create request is in flight ('spawning') — the
     * server list cannot judge such placeholders yet (the poll skips them).
     */
    pod_url: string;
    status: 'spawning' | 'ready';
    /**
     * The GPU the pod was spawned on (for example, "4090" or "6000") — chosen in the
     * New-pod dialog and sent to POST /v1/comfy/cloud as `gpu`. Drives the
     * pod button's label ("4090" plus a badge with the queued job count).
     * Undefined only for pods predating GPU selection.
     */
    gpu?: string;
    run: RunState;
    /**
     * The pod's queue as last reported by GET /v1/comfy/cloud — the
     * server's authoritative list (prompt ids, queued/running status,
     * workflow/generation ids). NEVER mutated client-side: submissions
     * appear via the immediate list refresh after the 202 accept, then via
     * the regular poll. Badges and the Auto load balancer read its length.
     */
    queue: CloudPodQueueEntry[];
};

/** Run state of a single pod (idle → running → done/error). */
export type RunState =
    | { status: 'idle' }
    | { status: 'running'; events: CloudStreamEvent[] }
    | { status: 'done'; events: CloudStreamEvent[] }
    | { status: 'error'; events: CloudStreamEvent[]; message: string };

/**
 * A result item flattened across all generations — display metadata only
 * (no payload), tagged with its source generation id and its zero-based
 * index within that generation's result array. The media itself streams
 * from GET .../generate/{generationId}/result/{resultIndex}, which the
 * viewer points <img>/<video> straight at.
 */
export type ViewerEntry = GenerationResultMeta & { generationId: string; resultIndex: number };

// NOTE: BoundaryLink moved to @underload/comfy (workflow-parser.ts) — it is
// only used by the workflow parser's subgraph boundary rewriting.

/** A selected PROMPT-tab field: which widget on which node (tree reference + its key). */
export type PromptWidgetRef = { key: string; node: UINode; widget: UIWidget };

/**
 * Content area switcher — "json" shows the workflow node layout; "prompt"
 * shows the quick-edit fields picked via label clicks; "results" lists the
 * workflow's generations.
 */
export type EditorContentTab = 'json' | 'prompt' | 'results';

/**
 * OUTPUT-tab presentation mode — compact list rows ('list') or a masonry
 * grid of result thumbnails ('thumbs'). The toggle lives in the footer,
 * which swaps its New/Auto/pod controls for it on the results tab.
 */
export type OutputViewMode = 'list' | 'thumbs';

/**
 * A generation's dominant media kind — what the OUTPUT tab badges each
 * generation with. A multi-output graph can emit several kinds at once
 * (e.g. an image AND its video interpolation); the badge marks the
 * "highest" kind present by priority video > audio > image.
 */
export type MediaKind = GenerationResultMeta['type'];
