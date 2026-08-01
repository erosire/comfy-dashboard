// Shared types for the workflow dashboard feature.
//
// Extracted from the original CloudTab.tsx so both the WorkflowDashboard
// component and its sub-components / hooks can import them from one place.

import type { CloudPodStatusResult, CloudStreamEvent, GenerationResultMeta } from '../../../../api';
import type { UINode, UIWidget } from '../../../../nodes/node-type';

/** A cloud pod tracked by the dashboard, with its run + queue state. */
export type PodEntry = {
    id: string;
    podNumber: number;
    name: string;
    pod_url: string;
    status: 'spawning' | 'ready' | 'error';
    /**
     * Consecutive heartbeat failures. Reset to 0 on every successful probe.
     * The pod (and its "#N" button) is removed once this reaches
     * MAX_POD_FAILURES — i.e. when the pod_url has stopped working.
     */
    failCount: number;
    run: RunState;
    /**
     * Generations currently processed server-side for this pod. A pod is
     * never blocked — every #N click queues another job. The
     * generations polling effect prunes this list and settles run.status
     * (done/error) once nothing is left in flight.
     */
    activeGenerationIds: string[];
    health?: CloudPodStatusResult;
    error?: string;
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

/**
 * Normalized link for boundary rewriting — works for both v0.4 tuple and v1
 * object formats.  Used to resolve external inputs flowing into a subgraph.
 */
export type BoundaryLink = {
    targetNodeId: string;
    targetSlot: number;
    sourceNodeId: string;
    sourceSlot: number;
};

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
