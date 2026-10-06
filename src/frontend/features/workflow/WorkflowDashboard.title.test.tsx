// =============================================================================
// Visible version-title regression tests
//
// The header title's APP-NAME fallback now carries the package version
// ("Comfy Dashboard v<version>") so users can see which release they are
// running right where the product is named. The version comes from the
// compile-time __APP_VERSION__ constant injected by vite.config.ts /
// vitest.config.ts `define` (readFileSync(resolve(process.cwd(),
// 'package.json')) → JSON.stringify(pkg.version)) and declared ambient in
// src/vite-env.d.ts — the same convention as distribution/story-generator
// (src/features/sidebar.tsx) and distribution/ScriptingSpaceFormatter
// (src/dashboards/FormatterDashboard.tsx footer).
//
// Verifies BOTH title branches at the real composition point
// (WorkflowDashboard.tsx → DashboardHeaderControls title prop):
//   1. Fresh dashboard (no selected workflow): the header shows exactly
//      "Comfy Dashboard v" + __APP_VERSION__ — the versioned app-name
//      fallback. Using the SAME compile constant in the expectation keeps
//      the test version-agnostic (package bumps never break it) while still
//      failing loudly if the `define` wiring breaks (the constant becomes a
//      literal ReferenceError inside the test module when undefined).
//   2. A saved workflow loaded through the REAL bootstrap flow
//      (persisted selectedId → DashboardStoreProvider → BootstrapLayer →
//      selectWorkflow → editor parse) shows the workflow's NAME as the
//      title — no version suffix, no app name. This pins the
//      named-workflow branch against regressions from the version change.
//
// The full <App /> is mounted with the package's existing createRoot + act
// harness (WorkflowDashboard.gpuSelect.test.tsx pattern); only the network
// API is mocked, at the module boundary (src/frontend/api/index.ts), so the
// assertion covers the production title composition rather than a
// re-implementation.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { App } from '../../App';
import { fetchWorkflow } from '../../api';
import type { Workflow, WorkflowMeta } from '../../api';

// ── Fixtures (vi.hoisted: the vi.mock factory below runs during module
// import, before this module body executes — top-level consts would be TDZ) ──

const fixtures = vi.hoisted(() => {
    const WORKFLOW_ID = 'wf-title-1';
    const WORKFLOW_NAME = 'Pod Runner';

    const WORKFLOW_META: import('../../api').WorkflowMeta = {
        id: WORKFLOW_ID,
        name: WORKFLOW_NAME,
        nodeCount: 2,
        createdDate: '2026-10-06T00:00:00.000Z',
        modifiedDate: '2026-10-06T00:00:00.000Z'
    };

    // Minimal v1 workflow raw — same shape as
    // WorkflowDashboard.inputFields.test.ts makeWorkflow/makeUniversalDataInputNode:
    // a UniversalDataToImage feeder → PreviewImage sink. parseWorkflowJson
    // (@underload/comfy) accepts this shape (proven by the existing tests).
    const WORKFLOW_RAW: Record<string, unknown> = {
        version: 1,
        nodes: [
            {
                id: 7,
                type: 'UniversalDataToImage',
                pos: [0, 0],
                size: [200, 100],
                flags: {},
                order: 0,
                mode: 0,
                properties: {},
                inputs: [],
                outputs: [{ name: 'image', type: 'IMAGE', links: [1], slot_index: 0 }],
                widgets_values: ['']
            },
            {
                id: 901,
                type: 'PreviewImage',
                pos: [0, 0],
                size: [200, 100],
                flags: {},
                order: 1,
                mode: 0,
                properties: {},
                inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
                outputs: []
            }
        ],
        links: [{ id: 1, origin_id: 7, origin_slot: 0, target_id: 901, target_slot: 0, type: 'IMAGE' }]
    };

    // Full detail the selection loader (selectWorkflow → fetchWorkflow)
    // returns; its `raw` is what drives the editor parse (rawJson non-null
    // → isEditingSaved → title switches to the workflow name).
    const WORKFLOW_DETAIL: import('../../api').Workflow = {
        ...WORKFLOW_META,
        nodes: [],
        raw: WORKFLOW_RAW
    };

    return { WORKFLOW_ID, WORKFLOW_NAME, WORKFLOW_META, WORKFLOW_DETAIL };
});

// ── API mock (module boundary — src/frontend/api/index.ts, the same module
// every consumer imports: context/store.tsx '../api', WorkflowDashboard
// '../../api') ────────────────────────────────────────────────────────────────
// Real implementations stay for the pure helpers (generationResultUrl …);
// only the network-touching calls used during mount are stubbed:
//   - fetchWorkflows: BootstrapLayer's bootstrap refresh
//   - fetchWorkflow: the selection detail loader (WorkflowDashboard.tsx
//     selectWorkflow flow)
//   - fetchQueue/fetchStatus: store refresh hooks (defensive — nothing
//     calls them on mount today, but a stray call must not hit the network)
//   - cloudListPods: usePods' pod-registry poll (fires once on mount,
//     then every GPU_LIST_POLL_INTERVAL_MS — cleared on unmount)
vi.mock('../../api', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../api')>();
    return {
        ...actual,
        fetchWorkflows: vi.fn(async () => ({ workflows: [fixtures.WORKFLOW_META] })),
        fetchWorkflow: vi.fn(async () => ({ workflow: fixtures.WORKFLOW_DETAIL })),
        fetchQueue: vi.fn(async () => ({ queue: [] })),
        fetchStatus: vi.fn(async () => ({
            connected: true,
            queueSize: 0,
            activeJobs: 0,
            uptime: 0
        })),
        cloudListPods: vi.fn(async () => ({ available_gpus: [], pods: [] }))
    };
});

// ── Mount harness (WorkflowDashboard.gpuSelect.test.tsx pattern) ─────────────

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeAll(() => {
    // jsdom does NOT implement Element.scrollIntoView, and
    // WorkflowSidebar.tsx (line ~140) auto-scrolls the selected item in a
    // layout effect once a workflow is selected — the exact flow under
    // test. No-op stub: the assertion targets the header title, not scroll.
    Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // Reset persisted selection between tests — the store's useState
    // initializer reads 'comfyDashboard:selectedId' (context/store.tsx
    // STORAGE_KEY_SELECTED) on first render.
    localStorage.clear();
    // Drop recorded mock calls (implementations set in the vi.mock factory
    // are preserved — mockClear only resets call history).
    vi.clearAllMocks();
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

// Drain the mocked-promise bootstrap chain (all stubs resolve immediately,
// so the whole chain — refreshWorkflows → selectWorkflow → editor parse —
// is microtask work flushed by a couple of awaited act rounds).
async function flushAsync(): Promise<void> {
    await act(async () => {
        await Promise.resolve();
    });
}

async function renderApp(): Promise<void> {
    await act(async () => {
        root.render(<App />);
        await Promise.resolve();
    });
    await flushAsync();
}

// DOM chain from <App />: FullScreen > DarkThemeWrapper > DashboardShell
// (App.tsx), and the header is DashboardShell's first child
// (ComfyDashboard.tsx: DashboardShell → DashboardHeader → headerControls).
// With the mocked API the header contains NO warning badge, and the
// toggle/preferences buttons render SVG icons only — so the header's
// textContent is exactly the title string.
function headerElement(): HTMLElement {
    const fullScreen = container.firstElementChild;
    expect(fullScreen, 'App FullScreen wrapper missing').toBeTruthy();
    const shell = fullScreen!.firstElementChild?.firstElementChild;
    expect(shell, 'DashboardShell missing').toBeTruthy();
    const header = shell!.firstElementChild;
    expect(header, 'DashboardHeader missing').toBeTruthy();
    return header as HTMLElement;
}

describe('WorkflowDashboard visible version title', () => {
    it('app-name fallback shows "Comfy Dashboard v<package version>" when no workflow is selected', async () => {
        await renderApp();

        // Exact title: app name + the compile-time version constant (the
        // same `define`-injected value vite build bakes into the bundle).
        expect(headerElement().textContent).toBe(`Comfy Dashboard v${__APP_VERSION__}`);

        // The fallback branch must not have loaded any workflow detail —
        // proving the versioned text really is the app-name fallback.
        expect(vi.mocked(fetchWorkflow).mock.calls).toEqual([]);
    });

    it('saved-workflow branch shows the workflow name verbatim — no version suffix', async () => {
        // Persisted selection → the store initializer picks it up, then the
        // real bootstrap flow loads the detail (mocked fetchWorkflow).
        localStorage.setItem('comfyDashboard:selectedId', fixtures.WORKFLOW_ID);
        await renderApp();

        // The named-workflow branch REPLACES the app-name fallback entirely.
        expect(headerElement().textContent).toBe(fixtures.WORKFLOW_NAME);

        // The title really came from the loaded detail, not an accident.
        expect(
            vi.mocked(fetchWorkflow).mock.calls.map((call) => call[1])
        ).toEqual([fixtures.WORKFLOW_ID]);
    });
});
