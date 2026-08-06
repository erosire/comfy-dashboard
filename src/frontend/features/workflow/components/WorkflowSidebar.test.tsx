// WorkflowSidebar tests.
//
// These tests pin the startup scroll contract: the selected workflow row is
// the only scroll target, and unrelated dashboard state cannot move the list
// to the bottom. They also cover a persisted selection outside the first page.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowMeta } from '../../../api';
import { WorkflowSidebar } from './WorkflowSidebar';

// React 18 requires this flag for deterministic act() warnings in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: ReturnType<typeof vi.fn>;
let originalScrollIntoView: typeof HTMLElement.prototype.scrollIntoView;

beforeEach(() => {
    // jsdom does not implement layout scrolling, so the test supplies the
    // browser method and inspects the exact selected element invocation.
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    scrollIntoView = vi.fn();
    // Vitest's generic mock type is broader than the DOM method overload;
    // runtime behavior is intentionally identical, so narrow only at this
    // test seam rather than weakening production component types.
    HTMLElement.prototype.scrollIntoView =
        scrollIntoView as unknown as typeof HTMLElement.prototype.scrollIntoView;
});

afterEach(() => {
    // Unmount before restoring the prototype so layout-effect cleanup cannot
    // observe a half-restored DOM API in a later test.
    act(() => root.unmount());
    container.remove();
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

function makeWorkflow(id: string): WorkflowMeta {
    // The sidebar only reads id and name, while the remaining fields keep the
    // fixture valid against the shared API type used by production metadata.
    return {
        id,
        name: `Workflow ${id}`,
        nodeCount: 1,
        createdDate: '2026-08-01T00:00:00.000Z',
        modifiedDate: '2026-08-01T00:00:00.000Z'
    };
}

function renderSidebar(workflows: WorkflowMeta[], selectedId: string | null): void {
    // A stable workflow array makes the assertion isolate selection-driven
    // scrolling rather than an incidental parent allocation.
    act(() => {
        root.render(
            <WorkflowSidebar
                workflows={workflows}
                selectedId={selectedId}
                searchText=""
                onSearchChange={vi.fn()}
                onSelect={vi.fn()}
            />
        );
    });
}

describe('WorkflowSidebar selected-workflow scroll', () => {
    it('scrolls the selected workflow into view when the list first opens', () => {
        const workflows = ['first', 'selected', 'last'].map(makeWorkflow);

        renderSidebar(workflows, 'selected');

        const selectedItem = container.querySelector('[data-testid="workflow-item-selected"]');
        expect(selectedItem).toBeTruthy();
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
        expect(scrollIntoView.mock.instances[0]).toBe(selectedItem);
    });

    it('waits for the workflow list and then targets the persisted selection', () => {
        const workflows = ['first', 'selected'].map(makeWorkflow);

        renderSidebar([], 'selected');
        expect(scrollIntoView).not.toHaveBeenCalled();

        renderSidebar(workflows, 'selected');

        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.instances[0]).toBe(
            container.querySelector('[data-testid="workflow-item-selected"]')
        );
    });

    it('keeps a selected workflow outside the first page scrollable', () => {
        const workflows = Array.from({ length: 101 }, (_, index) => makeWorkflow(`workflow-${index}`));

        renderSidebar(workflows, 'workflow-100');

        const selectedItem = container.querySelector('[data-testid="workflow-item-workflow-100"]');
        expect(selectedItem).toBeTruthy();
        expect(scrollIntoView).toHaveBeenCalledTimes(1);
        expect(scrollIntoView.mock.instances[0]).toBe(selectedItem);
    });
});
