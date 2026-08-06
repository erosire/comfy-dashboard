// PromptFieldsPane tests.
//
// These tests pin the two PROMPT-tab interaction contracts requested by the
// UI: labels are editable without removing a card, and removal occurs only
// when the dedicated ✕ button is activated. The persistence helper tests also
// verify exact JSON output for renamed labels.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UINode } from '../../../nodes/node-type';
import { PromptFieldsPane } from './PromptFieldsPane';
import {
    promptWidgetKey,
    readSavedPromptFieldLabels,
    writePromptFieldLabelsToRaw
} from './utils';

// React 18 requires this flag for deterministic act() behavior in jsdom.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const node: UINode = {
    id: '7',
    classType: 'UnregisteredPromptNode',
    connections: [],
    outputs: [],
    widgets: [{ index: 0, value: 'original', inferredName: 'prompt' }],
    mode: 0,
    order: 0,
    properties: {},
    flags: {},
    position: [0, 0],
    size: [200, 100],
    _sourceFormat: 'workflow-v1'
};

const key = promptWidgetKey(node, node.widgets[0]);

function renderPane(overrides: Partial<React.ComponentProps<typeof PromptFieldsPane>> = {}) {
    const props: React.ComponentProps<typeof PromptFieldsPane> = {
        entries: [{ key, node, widget: node.widgets[0] }],
        promptFieldLabels: new Map(),
        togglePromptField: vi.fn(),
        updatePromptFieldLabel: vi.fn(),
        updateNodeWidget: vi.fn(),
        inputFields: new Set(),
        toggleInputField: vi.fn(),
        ...overrides
    };
    act(() => root.render(<PromptFieldsPane {...props} />));
    return props;
}

function setInputValue(input: HTMLInputElement, value: string): void {
    // React's controlled-input test seam must use the native setter before the
    // bubbling input event so the component receives the exact edited value.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    act(() => input.dispatchEvent(new Event('input', { bubbles: true })));
}

describe('PromptFieldsPane interactions', () => {
    it('allows the item label to be edited without invoking removal', () => {
        const updatePromptFieldLabel = vi.fn();
        const togglePromptField = vi.fn();
        renderPane({ updatePromptFieldLabel, togglePromptField });

        const label = container.querySelector<HTMLInputElement>(`[data-testid="prompt-field-label-${key}"]`);
        expect(label).not.toBeNull();
        expect(label!.value).toBe('#1');

        setInputValue(label!, 'Portrait prompt');

        expect(updatePromptFieldLabel).toHaveBeenLastCalledWith(key, 'Portrait prompt');
        expect(togglePromptField).not.toHaveBeenCalled();
        expect(container.querySelector(`[data-testid="prompt-field-${key}"]`)).not.toBeNull();
    });

    it('keeps a cleared label editable so a replacement can be typed', () => {
        const updatePromptFieldLabel = vi.fn();
        renderPane({ updatePromptFieldLabel, promptFieldLabels: new Map([[key, 'Existing']]) });

        const label = container.querySelector<HTMLInputElement>(`[data-testid="prompt-field-label-${key}"]`);
        expect(label).not.toBeNull();

        setInputValue(label!, '');
        expect(updatePromptFieldLabel).toHaveBeenLastCalledWith(key, '');
    });

    it('removes an item only when the localized ✕ button is clicked', () => {
        const togglePromptField = vi.fn();
        renderPane({ togglePromptField });

        const header = container.querySelector(`[data-testid="prompt-field-header-${key}"]`);
        const label = container.querySelector(`[data-testid="prompt-field-label-${key}"]`);
        const remove = container.querySelector<HTMLButtonElement>(`[data-testid="prompt-field-remove-${key}"]`);
        expect(header).not.toBeNull();
        expect(label).not.toBeNull();
        expect(remove).not.toBeNull();

        act(() => header!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        act(() => label!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(togglePromptField).not.toHaveBeenCalled();

        act(() => remove!.click());
        expect(togglePromptField).toHaveBeenCalledTimes(1);
        expect(togglePromptField).toHaveBeenCalledWith(node, 0);
    });
});

describe('PROMPT field label persistence', () => {
    it('writes labels deterministically and restores only resolvable non-empty labels', () => {
        const raw: Record<string, unknown> = { version: 1, extra: { keep: true } };
        const written = writePromptFieldLabelsToRaw(
            raw,
            new Map([
                ['99:stale', 'Stale'],
                [key, ' Portrait prompt '],
                ['7:empty', '   ']
            ])
        );

        expect(written).toEqual({
            version: 1,
            extra: {
                keep: true,
                promptFieldLabels: {
                    [key]: 'Portrait prompt',
                    '99:stale': 'Stale'
                }
            }
        });

        // The read helper validates against the current parsed tree, so stale
        // keys and blank values cannot leak back into the editor state.
        expect(readSavedPromptFieldLabels(written, [node])).toEqual(new Map([[key, 'Portrait prompt']]));
    });
});
