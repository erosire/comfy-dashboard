// Preferences dialog tests.
//
// The harness uses the real dialog and a mocked fetch so it verifies the user
// visible profile/version editor, multiline values, and exact PUT payload.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DashboardHeaderControls } from './DashboardHeaderControls';
import {
    draftsToPreferenceVariables,
    preferenceTextToValue,
    preferenceValueToText,
    preferenceVersionLabel,
    preferenceVariablesToDrafts,
    clearPreferenceDraftMemory,
    PreferencesDialog
} from './PreferencesDialog';

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
    clearPreferenceDraftMemory();
    vi.unstubAllGlobals();
});

const render = (ui: React.ReactElement) => {
    act(() => root.render(ui));
};

const click = (element: Element | null) => {
    expect(element).not.toBeNull();
    act(() => element!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};

const setInput = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(prototype.prototype, 'value')!.set!;
    setter.call(element, value);
    act(() => element.dispatchEvent(new Event('input', { bubbles: true })));
};

// React select changes use the native change event rather than input.
const setSelect = (element: HTMLSelectElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(element, value);
    act(() => element.dispatchEvent(new Event('change', { bubbles: true })));
};

const flushReact = async () => {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
};

describe('preference value conversion', () => {
    it('round-trips text and arbitrary JSON values without losing version data', () => {
        expect(preferenceValueToText('hello\nworld')).toBe('hello\nworld');
        expect(preferenceValueToText({ enabled: true, count: 2 })).toBe(`{
  "enabled": true,
  "count": 2
}`);
        expect(preferenceTextToValue('hello\nworld')).toBe('hello\nworld');
        expect(preferenceTextToValue('14')).toBe(14);
        expect(preferenceTextToValue('{"enabled":true}')).toEqual({ enabled: true });
        expect(preferenceVersionLabel('current')).toBe('v0');
        expect(preferenceVersionLabel('release-2026')).toBe('release-2026');
    });

    it('preserves arbitrary variable and version keys when converting rows', () => {
        const variables = {
            'service.preference': { current: 'dark', 'release-2026': 'light' }
        };
        const drafts = preferenceVariablesToDrafts(variables);
        expect(drafts).toEqual([
            {
                name: 'service.preference',
                versions: [
                    { key: 'current', value: 'dark' },
                    { key: 'release-2026', value: 'light' }
                ]
            }
        ]);
        expect(draftsToPreferenceVariables(drafts)).toEqual(variables);
    });
});

describe('DashboardHeaderControls preferences action', () => {
    it('renders a person-shaped preferences button at the end of the header', () => {
        const onPreferencesClick = vi.fn();
        render(
            <DashboardHeaderControls
                onToggleSidebar={vi.fn()}
                title="Comfy Dashboard"
                titleClickable={false}
                onTitleClick={vi.fn()}
                onPreferencesClick={onPreferencesClick}
            />
        );

        const button = container.querySelector<HTMLButtonElement>('[data-testid="preferences-button"]');
        expect(button).not.toBeNull();
        expect(button!.getAttribute('aria-label')).toBe('Open preferences');
        expect(button!.querySelector('svg')).not.toBeNull();
        click(button);
        expect(onPreferencesClick).toHaveBeenCalledTimes(1);
    });
});

describe('PreferencesDialog', () => {
    it('loads the blank default profile and renders arbitrary version keys as editable text areas', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
                theme: { current: 'dark', 'release-2026': 'dark-blue' },
                multiline: { notes: 'line one\nline two' }
            }), { status: 200 })));

        render(<PreferencesDialog baseUrl="http://host:5000/v1/comfy" onClose={vi.fn()} />);
        await flushReact();

        expect(vi.mocked(fetch).mock.calls).toEqual([
            ['http://host:5000/v1/preferences/variables']
        ]);
        expect(container.querySelector<HTMLInputElement>('[aria-label="Preference profile"]')!.value).toBe('');
        expect(container.querySelectorAll('textarea')).toHaveLength(2);
        expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Preference value 1"]')!.value).toBe('dark');
        expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Preference value 2"]')!.value).toBe(
            'line one\nline two'
        );
        expect(container.querySelector<HTMLSelectElement>('[aria-label="Version key 1"]')!.value).toBe('current');
        expect([...container.querySelectorAll<HTMLSelectElement>('[aria-label="Version key 1"] option')].map((option) => option.textContent)).toEqual([
            'v0',
            'release-2026'
        ]);
        expect(container.querySelector<HTMLTextAreaElement>('textarea')!.getAttribute('rows')).toBe('1');
        expect(getComputedStyle(container.querySelector<HTMLTextAreaElement>('textarea')!.parentElement!).flexDirection).toBe('row');
        expect(getComputedStyle(container.querySelector<HTMLSelectElement>('[aria-label="Version key 1"]')!.parentElement!).flexBasis).toBe('20%');

        // The selected arbitrary key is retained in browser memory when the
        // dialog is closed and opened again; the second open still fetches the
        // API, but the local draft/selection is what the current UI uses.
        setSelect(container.querySelector<HTMLSelectElement>('[aria-label="Version key 1"]')!, 'release-2026');
        act(() => root.render(null));
        render(<PreferencesDialog baseUrl="http://host:5000/v1/comfy" onClose={vi.fn()} />);
        await flushReact();
        expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
        expect(container.querySelector<HTMLSelectElement>('[aria-label="Version key 1"]')!.value).toBe('release-2026');
    });

    it('loads a changed profile and saves edited values with custom version labels', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ theme: { current: 'dark' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ theme: { current: 'light' } }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                theme: { current: 'light', 'release-2026': 'line one\nline two' }
            }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        render(<PreferencesDialog baseUrl="http://host:5000/v1/comfy" onClose={vi.fn()} />);
        await flushReact();

        const profile = container.querySelector<HTMLInputElement>('[aria-label="Preference profile"]')!;
        setInput(profile, 'alice');
        click(container.querySelector('button[aria-label="Load preference profile"]'));
        await flushReact();

        expect(fetchMock.mock.calls[1][0]).toBe(
            'http://host:5000/v1/preferences/variables?profile=alice'
        );
        expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Preference value 1"]')!.value).toBe('light');

        click(container.querySelector('button[aria-label="Add version to preference 1"]'));
        expect(container.querySelectorAll('textarea')).toHaveLength(1);
        expect(container.querySelector<HTMLSelectElement>('[aria-label="Version key 1"]')!.value).toBe('v1');
        setInput(
            container.querySelector<HTMLTextAreaElement>('[aria-label="Preference value 1"]')!,
            'line one\nline two'
        );
        // Editing the local draft does not issue a PUT before the explicit save.
        expect(fetchMock).toHaveBeenCalledTimes(2);
        click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Save')!);
        await flushReact();

        expect(fetchMock.mock.calls[2]).toEqual([
            'http://host:5000/v1/preferences/variables?profile=alice',
            {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    theme: { current: 'light', v1: 'line one\nline two' }
                })
            }
        ]);
        expect(container.querySelector('[role="status"]')?.textContent).toBe('Preferences saved.');
    });

    it('increments newly added version keys as v1, v2, and keeps them in the dropdown', async () => {
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
            theme: { current: 'dark' }
        }), { status: 200 })));

        render(<PreferencesDialog baseUrl="http://host:5000/v1/comfy" onClose={vi.fn()} />);
        await flushReact();
        click(container.querySelector('button[aria-label="Add version to preference 1"]'));
        click(container.querySelector('button[aria-label="Add version to preference 1"]'));

        const select = container.querySelector<HTMLSelectElement>('[aria-label="Version key 1"]')!;
        expect(select.value).toBe('v2');
        expect([...select.options].map((option) => option.textContent)).toEqual(['v0', 'v1', 'v2']);
    });

    it('adds a new preference row from the full-width list action and requires its name before saving', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({}), { status: 200 })
        ));

        render(<PreferencesDialog baseUrl="http://host:5000/v1/comfy" onClose={vi.fn()} />);
        await flushReact();
        const addButton = [...container.querySelectorAll('button')].find(
            (button) => button.textContent === 'Add New Preference'
        )!;
        expect(getComputedStyle(addButton).width).toBe('100%');
        expect(container.textContent).not.toContain('No preference values in this profile yet. Add one below.');
        click(addButton);
        expect(container.querySelectorAll('textarea')).toHaveLength(1);

        click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Save')!);
        expect(container.querySelector('[role="alert"]')?.textContent).toBe('Preference 1 needs a name.');
        expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it('closes from the X control or backdrop, while the panel itself stops propagation', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            new Response(JSON.stringify({}), { status: 200 })
        ));
        const onClose = vi.fn();

        render(<PreferencesDialog baseUrl="http://host:5000/v1/comfy" onClose={onClose} />);
        await flushReact();

        expect([...container.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
            '×',
            'Load',
            'Add New Preference',
            'Close',
            'Save'
        ]);
        click(container.querySelector('button[aria-label="Close preferences"]'));
        expect(onClose).toHaveBeenCalledTimes(1);

        click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Close')!);
        expect(onClose).toHaveBeenCalledTimes(2);

        click(container.querySelector('[role="presentation"]'));
        expect(onClose).toHaveBeenCalledTimes(3);

        click(container.querySelector('[role="dialog"]'));
        expect(onClose).toHaveBeenCalledTimes(3);
    });
});
