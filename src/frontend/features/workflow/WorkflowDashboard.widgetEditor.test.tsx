// =============================================================================
// WidgetValueEditor tests — registry-driven widget controls.
//
// Verifies that each registry widgetType renders the control that restricts
// input to what the node accepts:
//   1. COMBO with options renders a dropdown limited to those options (and
//      keeps a stale current value selectable instead of snapping away).
//   2. COMBO with an EMPTY options list (runtime-populated, e.g. LoadImage)
//      keeps the free-text field.
//   3. INT/FLOAT render number inputs carrying min/max/step, with blur-time
//      clamping to the defined range; display "slider" adds a range track.
//   4. BOOLEAN renders a click toggle that flips the stored value.
//   5. STRING keeps the free-text field and surfaces the registry
//      placeholder.
//   6. Unregistered nodes fall back to the free-text field.
// =============================================================================

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { WidgetValueEditor } from './components';
import type { UINode, UIWidget } from '../../nodes/node-type';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal UINode fixture — WidgetValueEditor only reads id/classType/widgets. */
function makeNode(classType: string, widgetValue: unknown, widgetIndex = 0): { node: UINode; widget: UIWidget } {
    const widget: UIWidget = { value: widgetValue, index: widgetIndex };
    const node = { id: '7', classType, widgets: [widget] } as unknown as UINode;
    return { node, widget };
}

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

function render(ui: React.ReactElement): void {
    act(() => root.render(ui));
}

/** Fire a React-compatible change on a form element after setting its value. */
function fireValueChange(el: HTMLElement, prototype: typeof HTMLInputElement | typeof HTMLSelectElement | typeof HTMLTextAreaElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(prototype.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

const fireInput = (el: HTMLElement, value: string) => fireValueChange(el, HTMLInputElement, value);
const fireSelect = (el: HTMLElement, value: string) => fireValueChange(el, HTMLSelectElement, value);
const fireBlur = (el: HTMLElement) => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));

/**
 * Stateful harness — mirrors the real app loop where updateNodeWidget
 * writes back into the widget tree: the editor's parent re-renders with the
 * new value after every commit, so controlled inputs keep what was typed.
 * (The raw string is stored as-is; type coercion happens inside the real
 * updateNodeWidget and isn't needed to exercise the controls.)
 */
const Harness: React.FC<{
    classType: string;
    widgetIndex: number;
    initial: unknown;
    spy: (...args: unknown[]) => void;
}> = ({ classType, widgetIndex, initial, spy }) => {
    const [value, setValue] = React.useState<unknown>(initial);
    const widget: UIWidget = { value, index: widgetIndex };
    const node = { id: '7', classType, widgets: [widget] } as unknown as UINode;
    return (
        <WidgetValueEditor
            node={node}
            widget={widget}
            updateNodeWidget={(id, idx, raw) => {
                spy(id, idx, raw);
                setValue(raw);
            }}
        />
    );
};

// ── COMBO ─────────────────────────────────────────────────────────────

describe('WidgetValueEditor — COMBO', () => {
    it('renders a dropdown with exactly the registry options for ResolutionSelector', () => {
        const { node, widget } = makeNode('ResolutionSelector', '3:2 (Photo)', 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        const select = container.querySelector<HTMLSelectElement>('select');
        expect(select).not.toBeNull();
        const options = Array.from(select!.querySelectorAll('option')).map((o) => o.value);
        expect(options).toEqual([
            '1:1 (Square)',
            '2:3 (Portrait Photo)',
            '3:2 (Photo)',
            '3:4 (Portrait Standard)',
            '4:3 (Standard)',
            '9:16 (Portrait Widescreen)',
            '16:9 (Widescreen)',
            '21:9 (Ultrawide)',
        ]);
        expect(select!.value).toBe('3:2 (Photo)');
        // No free-text fallback for a constrained field.
        expect(container.querySelector<HTMLTextAreaElement>('textarea')).toBeNull();
    });

    it('keeps a stale value selectable by adding it as an extra option', () => {
        const { node, widget } = makeNode('ResolutionSelector', '5:4 (Legacy)', 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        const select = container.querySelector<HTMLSelectElement>('select')!;
        const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
        expect(options.length).toBe(9);
        expect(options[0]).toBe('5:4 (Legacy)');
        expect(select.value).toBe('5:4 (Legacy)');
    });

    it('commits the chosen option on change', () => {
        const update = vi.fn();
        const { node, widget } = makeNode('ResolutionSelector', '1:1 (Square)', 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={update} />);

        const select = container.querySelector<HTMLSelectElement>('select')!;
        act(() => fireSelect(select, '16:9 (Widescreen)'));
        expect(update).toHaveBeenCalledWith('7', 0, '16:9 (Widescreen)');
    });

    it('renders sampler dropdown for KSampler (widget index 4)', () => {
        const { node, widget } = makeNode('KSampler', 'euler', 4);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        const select = container.querySelector<HTMLSelectElement>('select')!;
        const options = Array.from(select.querySelectorAll('option')).map((o) => o.value);
        expect(options).toContain('dpmpp_2m_sde');
        expect(select.value).toBe('euler');
    });

    it('keeps the free-text field for a COMBO with an empty option list (LoadImage)', () => {
        const { node, widget } = makeNode('LoadImage', 'example.png', 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        expect(container.querySelector<HTMLSelectElement>('select')).toBeNull();
        const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
        expect(textarea).not.toBeNull();
        expect(textarea.value).toBe('example.png');
    });
});

// ── INT / FLOAT ───────────────────────────────────────────────────────

describe('WidgetValueEditor — INT/FLOAT', () => {
    it('renders a number input carrying min/max/step from the registry', () => {
        const { node, widget } = makeNode('RemoteImageLoader', 30, 1); // timeout: INT 5..120 step 1
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        const input = container.querySelector<HTMLInputElement>('input[type=number]')!;
        expect(input).not.toBeNull();
        expect(input.min).toBe('5');
        expect(input.max).toBe('120');
        expect(input.step).toBe('1');
        expect(input.value).toBe('30');
    });

    it('clamps an out-of-range value on blur', () => {
        const spy = vi.fn();
        render(<Harness classType="RemoteImageLoader" widgetIndex={1} initial={30} spy={spy} />);

        const input = container.querySelector<HTMLInputElement>('input[type=number]')!;
        act(() => fireInput(input, '999'));
        act(() => fireBlur(input));
        // change commits raw; blur commits the clamped value (max 120),
        // and the field re-displays the clamped value.
        expect(spy).toHaveBeenCalledWith('7', 1, '999');
        expect(spy).toHaveBeenLastCalledWith('7', 1, '120');
        expect((container.querySelector<HTMLInputElement>('input[type=number]') as HTMLInputElement).value).toBe('120');
    });

    it('clamps below the minimum on blur', () => {
        const spy = vi.fn();
        render(<Harness classType="RemoteImageLoader" widgetIndex={1} initial={30} spy={spy} />);

        const input = container.querySelector<HTMLInputElement>('input[type=number]')!;
        act(() => fireInput(input, '-50'));
        act(() => fireBlur(input));
        expect(spy).toHaveBeenLastCalledWith('7', 1, '5');
        expect((container.querySelector<HTMLInputElement>('input[type=number]') as HTMLInputElement).value).toBe('5');
    });

    it('applies the registry round precision on blur (KSampler cfg, round 0.01)', () => {
        const spy = vi.fn();
        render(<Harness classType="KSampler" widgetIndex={3} initial={8.0} spy={spy} />);

        const input = container.querySelector<HTMLInputElement>('input[type=number]')!;
        act(() => fireInput(input, '8.456'));
        act(() => fireBlur(input));
        expect(spy).toHaveBeenLastCalledWith('7', 3, '8.46');
        expect((container.querySelector<HTMLInputElement>('input[type=number]') as HTMLInputElement).value).toBe('8.46');
    });

    it('renders a slider alongside the number field when display is "slider"', () => {
        const { node, widget } = makeNode('KSampler', 0.5, 6); // denoise: FLOAT 0..1 slider
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        const range = container.querySelector<HTMLInputElement>('input[type=range]')!;
        expect(range).not.toBeNull();
        expect(range.min).toBe('0');
        expect(range.max).toBe('1');
        expect(container.querySelector<HTMLInputElement>('input[type=number]')).not.toBeNull();
    });

    it('commits via the slider with constraints applied', () => {
        const spy = vi.fn();
        render(<Harness classType="KSampler" widgetIndex={6} initial={0.5} spy={spy} />);

        const range = container.querySelector<HTMLInputElement>('input[type=range]')!;
        act(() => fireInput(range, '0.42'));
        expect(spy).toHaveBeenLastCalledWith('7', 6, '0.42');
        expect((container.querySelector<HTMLInputElement>('input[type=range]') as HTMLInputElement).value).toBe('0.42');
    });

    it('does not clamp the seed widget against its beyond-safe-integer max', () => {
        const spy = vi.fn();
        render(<Harness classType="KSampler" widgetIndex={0} initial={0} spy={spy} />);

        const input = container.querySelector<HTMLInputElement>('input[type=number]')!;
        // No usable max attribute — the registry max exceeds the safe range.
        expect(input.max).toBe('');
        act(() => fireInput(input, '123456789'));
        act(() => fireBlur(input));
        expect(spy).toHaveBeenLastCalledWith('7', 0, '123456789');
        expect((container.querySelector<HTMLInputElement>('input[type=number]') as HTMLInputElement).value).toBe('123456789');
    });
});

// ── BOOLEAN ───────────────────────────────────────────────────────────

describe('WidgetValueEditor — BOOLEAN', () => {
    it('renders a toggle button showing the current state', () => {
        const { node, widget } = makeNode('PrimitiveBoolean', false, 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        const button = container.querySelector<HTMLButtonElement>('button')!;
        expect(button.textContent).toBe('false');
        expect(container.querySelector<HTMLTextAreaElement>('textarea')).toBeNull();
    });

    it('flips the value on click', () => {
        const update = vi.fn();
        const { node, widget } = makeNode('PrimitiveBoolean', false, 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={update} />);

        const button = container.querySelector<HTMLButtonElement>('button')!;
        act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(update).toHaveBeenCalledWith('7', 0, 'true');
    });
});

// ── STRING & fallbacks ────────────────────────────────────────────────

describe('WidgetValueEditor — STRING & fallbacks', () => {
    it('keeps the free-text field and surfaces the registry placeholder', () => {
        const { node, widget } = makeNode('RemoteImageLoader', '', 0); // url: STRING w/ placeholder
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
        expect(textarea).not.toBeNull();
        expect(textarea.placeholder).toBe('https://example.com/image.png');
    });

    it('falls back to the free-text field for unregistered node types', () => {
        const { node, widget } = makeNode('TotallyUnknownNode', 'anything', 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        expect(container.querySelector<HTMLSelectElement>('select')).toBeNull();
        expect(container.querySelector<HTMLInputElement>('input[type=number]')).toBeNull();
        expect(container.querySelector<HTMLButtonElement>('button')).toBeNull();
        expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('anything');
    });

    it('still commits free-text edits for unknown widgets', () => {
        const update = vi.fn();
        const { node, widget } = makeNode('TotallyUnknownNode', 'old', 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={update} />);

        const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
        act(() => fireValueChange(textarea, HTMLTextAreaElement, 'new'));
        expect(update).toHaveBeenCalledWith('7', 0, 'new');
    });
});

// ── base64 data: URI values ─────────────────────────────────────────────────
//
// A pasted image lands in a STRING widget as a multi-megabyte base64 data:
// URI — rendering the raw payload in the textarea stalls the browser, so the
// editor shows a compact read-only summary instead, with an on-demand raw
// view and a clear action (clear → empty field → fresh paste works again).

describe('WidgetValueEditor — base64 data: URI values', () => {
    // 'QUJD' decodes to 'ABC' → 3 bytes.
    const dataUri = 'data:image/png;base64,QUJD';
    // 4000-char payload → exactly 3000 bytes → "2.9 KB".
    const bigUri = `data:video/mp4;base64,${'AAAA'.repeat(1000)}`;

    it('renders a compact summary instead of the raw payload', () => {
        const { node, widget } = makeNode('UniversalDataToImage', bigUri, 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        // No editable textarea holding megabytes of base64.
        expect(container.querySelector<HTMLTextAreaElement>('textarea')).toBeNull();
        // The compact summary states it is base64, with mime + decoded size.
        expect(container.textContent).toContain('base64');
        expect(container.textContent).toContain('video/mp4');
        expect(container.textContent).toContain('≈2.9 KB');
    });

    it('keeps the full payload out of the DOM (no megabyte text nodes)', () => {
        const { node, widget } = makeNode('UniversalDataToImage', bigUri, 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        expect(container.textContent!.length).toBeLessThan(200);
        expect(container.textContent).not.toContain(bigUri);
        expect(container.textContent).toContain('data:video/mp4;base64,AAAA');
    });

    it('clear (✕) commits an empty value', () => {
        const update = vi.fn();
        const { node, widget } = makeNode('UniversalDataToImage', dataUri, 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={update} />);

        const clear = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
            (b) => b.textContent === '✕'
        )!;
        expect(clear).toBeDefined();
        act(() => clear.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(update).toHaveBeenCalledWith('7', 0, '');
    });

    it('"raw" reveals the full payload in the editable field; "▾" collapses back', () => {
        const spy = vi.fn();
        render(<Harness classType="UniversalDataToImage" widgetIndex={0} initial={dataUri} spy={spy} />);

        // Compact first: no textarea.
        expect(container.querySelector<HTMLTextAreaElement>('textarea')).toBeNull();

        const rawBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
            (b) => b.textContent === 'raw'
        )!;
        act(() => rawBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
        expect(textarea).not.toBeNull();
        expect(textarea.value).toBe(dataUri);

        // Edits in raw mode still commit through the same channel.
        act(() => fireValueChange(textarea, HTMLTextAreaElement, 'plain text now'));
        expect(spy).toHaveBeenCalledWith('7', 0, 'plain text now');

        // After committing a non-base64 value the editor is back to plain
        // free-text (harness re-renders with the stored value).
        expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('plain text now');
    });

    it('a cleared value returns to the plain free-text field (paste-ready)', () => {
        const spy = vi.fn();
        render(<Harness classType="UniversalDataToImage" widgetIndex={0} initial={dataUri} spy={spy} />);

        const clear = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
            (b) => b.textContent === '✕'
        )!;
        act(() => clear.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(spy).toHaveBeenCalledWith('7', 0, '');

        // Harness re-rendered with '' → plain free-text textarea again.
        const textarea = container.querySelector<HTMLTextAreaElement>('textarea')!;
        expect(textarea).not.toBeNull();
        expect(textarea.value).toBe('');
    });

    it('does not trigger the compact view for non-base64 data URIs or URLs', () => {
        const plain = makeNode('UniversalDataToImage', 'data:image/svg+xml,<svg/>', 0);
        render(<WidgetValueEditor node={plain.node} widget={plain.widget} updateNodeWidget={() => {}} />);
        expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
            'data:image/svg+xml,<svg/>'
        );
    });
});

// ── Power Lora Loader (rgthree) ─────────────────────────────────────────────
//
// The node's widget values are OBJECTS with a fixed shape (lora entries
// `{on, lora, strength, strengthTwo}`, a header widget, divider spacers and
// a trailing "➕ Add Lora" button string), so they render as dedicated
// controls instead of the generic JSON editor:
//   - lora entry → on/off toggle + filename field + strength number field
//     (clip strength field only in "Separate Model & Clip" mode)
//   - header     → a "toggle all" control flipping every lora on the node
//   - dividers   → read-only spacer
//   - add-lora   → read-only hint (rows are added in ComfyUI)
// Edits commit the whole entry as JSON text (parseInputValue re-parses it
// into a real object downstream).

describe('WidgetValueEditor — Power Lora Loader (rgthree) lora entries', () => {
    const NODE_TYPE = 'Power Lora Loader (rgthree)';

    const makeLoraNode = (
        entry: Record<string, unknown>,
        widgetIndex = 2,
        properties: Record<string, unknown> = { 'Show Strengths': 'Single Strength' }
    ) => {
        const widget: UIWidget = { value: entry, index: widgetIndex };
        const node = {
            id: '7',
            classType: NODE_TYPE,
            properties,
            widgets: [widget]
        } as unknown as UINode;
        return { node, widget };
    };

    it('renders toggle + filename + strength — no JSON textarea', () => {
        const { node, widget } = makeLoraNode({
            on: false,
            lora: 'LTX23_DR34ML4Y_v2.safetensors',
            strength: 0.7,
            strengthTwo: null
        });
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} testId="w" />);

        const toggle = container.querySelector<HTMLButtonElement>('[data-testid="w-toggle"]')!;
        expect(toggle.textContent).toBe('off');
        expect(container.querySelector<HTMLInputElement>('input[type=text]')!.value).toBe(
            'LTX23_DR34ML4Y_v2.safetensors'
        );
        const strength = container.querySelector<HTMLInputElement>('[data-testid="w-strength"]')!;
        expect(strength.value).toBe('0.7');
        // Single-strength mode: no clip strength field, and never a JSON editor.
        expect(container.querySelector('[data-testid="w-strengthTwo"]')).toBeNull();
        expect(container.querySelector('textarea')).toBeNull();
    });

    it('dimmed controls signal an off entry', () => {
        const { node, widget } = makeLoraNode({ on: false, lora: 'a.safetensors', strength: 1, strengthTwo: null });
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} testId="w" />);
        const text = container.querySelector<HTMLInputElement>('input[type=text]')!;
        expect(text.style.opacity).toBe('0.45');
    });

    it('toggle click commits the whole entry with on flipped, preserving strengthTwo: null', () => {
        const update = vi.fn();
        const entry = { on: false, lora: 'a.safetensors', strength: 0.7, strengthTwo: null };
        const { node, widget } = makeLoraNode(entry, 2);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={update} testId="w" />);

        act(() =>
            container
                .querySelector<HTMLButtonElement>('[data-testid="w-toggle"]')!
                .dispatchEvent(new MouseEvent('click', { bubbles: true }))
        );
        expect(update).toHaveBeenCalledWith('7', 2, JSON.stringify({ ...entry, on: true }));
        // Round-trips back into an object via parseInputValue downstream.
        expect(JSON.parse(update.mock.calls[0][2] as string)).toEqual({
            on: true,
            lora: 'a.safetensors',
            strength: 0.7,
            strengthTwo: null
        });
    });

    it('commits filename edits as the entry lora', () => {
        const update = vi.fn();
        const { node, widget } = makeLoraNode({ on: true, lora: 'old.safetensors', strength: 1, strengthTwo: null });
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={update} testId="w" />);

        const text = container.querySelector<HTMLInputElement>('input[type=text]')!;
        act(() => fireInput(text, 'new.safetensors'));
        expect(JSON.parse(update.mock.calls[update.mock.calls.length - 1][2] as string)).toEqual({
            on: true,
            lora: 'new.safetensors',
            strength: 1,
            strengthTwo: null
        });
    });

    it('commits strength edits as numbers', () => {
        const update = vi.fn();
        const { node, widget } = makeLoraNode({ on: true, lora: 'a.safetensors', strength: 1, strengthTwo: null });
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={update} testId="w" />);

        const strength = container.querySelector<HTMLInputElement>('[data-testid="w-strength"]')!;
        act(() => fireInput(strength, '0.35'));
        expect(JSON.parse(update.mock.calls[update.mock.calls.length - 1][2] as string)).toEqual({
            on: true,
            lora: 'a.safetensors',
            strength: 0.35,
            strengthTwo: null
        });
    });

    it('ignores an emptied strength field instead of committing NaN', () => {
        const update = vi.fn();
        const { node, widget } = makeLoraNode({ on: true, lora: 'a.safetensors', strength: 1, strengthTwo: null });
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={update} testId="w" />);

        const strength = container.querySelector<HTMLInputElement>('[data-testid="w-strength"]')!;
        act(() => fireInput(strength, ''));
        expect(update).not.toHaveBeenCalled();
    });

    it('shows the clip strength field in "Separate Model & Clip" mode and edits strengthTwo', () => {
        const update = vi.fn();
        const { node, widget } = makeLoraNode(
            { on: true, lora: 'a.safetensors', strength: 0.5, strengthTwo: null },
            2,
            { 'Show Strengths': 'Separate Model & Clip' }
        );
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={update} testId="w" />);

        // A null strengthTwo initialises to the model strength (rgthree mirrors this).
        const clip = container.querySelector<HTMLInputElement>('[data-testid="w-strengthTwo"]')!;
        expect(clip).not.toBeNull();
        expect(clip.value).toBe('0.5');

        act(() => fireInput(clip, '0.25'));
        expect(JSON.parse(update.mock.calls[update.mock.calls.length - 1][2] as string)).toEqual({
            on: true,
            lora: 'a.safetensors',
            strength: 0.5,
            strengthTwo: 0.25
        });
    });

    it('shows the clip field when a saved strengthTwo exists even without the property', () => {
        const { node, widget } = makeLoraNode(
            { on: true, lora: 'a.safetensors', strength: 0.5, strengthTwo: 0.25 },
            2,
            {}
        );
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} testId="w" />);
        expect(container.querySelector<HTMLInputElement>('[data-testid="w-strengthTwo"]')!.value).toBe('0.25');
    });

    it('toggle-all header flips every lora entry (mixed → all on)', () => {
        const update = vi.fn();
        const entryA = { on: true, lora: 'a.safetensors', strength: 1, strengthTwo: null };
        const entryB = { on: false, lora: 'b.safetensors', strength: 0.7, strengthTwo: null };
        const header: UIWidget = { value: { type: 'PowerLoraLoaderHeaderWidget' }, index: 1 };
        const node = {
            id: '7',
            classType: NODE_TYPE,
            properties: {},
            widgets: [
                { value: {}, index: 0 },
                header,
                { value: entryA, index: 2 },
                { value: entryB, index: 3 },
                { value: {}, index: 4 },
                { value: '', index: 5 }
            ]
        } as unknown as UINode;
        render(<WidgetValueEditor node={node} widget={header} updateNodeWidget={update} testId="w" />);

        const toggle = container.querySelector<HTMLButtonElement>('[data-testid="w"]')!;
        expect(toggle.textContent).toBe('◐ mixed');
        act(() => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        // Only the off entry needs a commit — the on one is already right.
        expect(update).toHaveBeenCalledTimes(1);
        expect(update).toHaveBeenCalledWith('7', 3, JSON.stringify({ ...entryB, on: true }));
    });

    it('toggle-all header flips all-on entries off', () => {
        const update = vi.fn();
        const entryA = { on: true, lora: 'a.safetensors', strength: 1, strengthTwo: null };
        const entryB = { on: true, lora: 'b.safetensors', strength: 0.7, strengthTwo: null };
        const header: UIWidget = { value: { type: 'PowerLoraLoaderHeaderWidget' }, index: 1 };
        const node = {
            id: '7',
            classType: NODE_TYPE,
            properties: {},
            widgets: [header, { value: entryA, index: 2 }, { value: entryB, index: 3 }]
        } as unknown as UINode;
        render(<WidgetValueEditor node={node} widget={header} updateNodeWidget={update} testId="w" />);

        const toggle = container.querySelector<HTMLButtonElement>('[data-testid="w"]')!;
        expect(toggle.textContent).toBe('● all on');
        act(() => toggle.dispatchEvent(new MouseEvent('click', { bubbles: true })));

        expect(update).toHaveBeenCalledTimes(2);
        expect(update).toHaveBeenCalledWith('7', 2, JSON.stringify({ ...entryA, on: false }));
        expect(update).toHaveBeenCalledWith('7', 3, JSON.stringify({ ...entryB, on: false }));
    });

    it('renders the trailing "➕ Add Lora" button string as a read-only hint', () => {
        const buttonWidget: UIWidget = { value: '', index: 6 };
        const node = { id: '7', classType: NODE_TYPE, properties: {}, widgets: [buttonWidget] } as unknown as UINode;
        render(<WidgetValueEditor node={node} widget={buttonWidget} updateNodeWidget={() => {}} />);

        expect(container.querySelector('textarea')).toBeNull();
        expect(container.querySelector('input')).toBeNull();
        expect(container.textContent).toContain('➕ Add Lora');
    });

    it('keeps the generic JSON editor for object values that are not lora-shaped', () => {
        const { node, widget } = makeNode('SomeOtherNode', { foo: 'bar', count: 3 }, 0);
        render(<WidgetValueEditor node={node} widget={widget} updateNodeWidget={() => {}} />);

        const jsonBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
            (b) => b.textContent === 'json'
        )!;
        expect(jsonBtn).toBeDefined();
        act(() => jsonBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        expect(container.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(
            JSON.stringify({ foo: 'bar', count: 3 }, null, 2)
        );
    });
});

// ── widgetLabel — Power Lora Loader labels ────────────────────────────────

describe('widgetLabel — Power Lora Loader (rgthree)', () => {
    it('labels each widget slot by its role, numbering lora entries only', async () => {
        const { widgetLabel } = await import('./components/utils');
        const widgets = [
            { value: {}, index: 0 },
            { value: { type: 'PowerLoraLoaderHeaderWidget' }, index: 1 },
            { value: { on: false, lora: 'a.safetensors', strength: 1, strengthTwo: null }, index: 2 },
            { value: { on: true, lora: 'b.safetensors', strength: 0.7, strengthTwo: null }, index: 3 },
            { value: { on: true, lora: 'c.safetensors', strength: 1, strengthTwo: null }, index: 4 },
            { value: {}, index: 5 },
            { value: '', index: 6 }
        ];
        const node = { id: '7', classType: 'Power Lora Loader (rgthree)', widgets } as unknown as UINode;

        expect(widgetLabel(node, widgets[0] as UIWidget)).toBe('—');
        expect(widgetLabel(node, widgets[1] as UIWidget)).toBe('Toggle All');
        expect(widgetLabel(node, widgets[2] as UIWidget)).toBe('LoRA 1');
        expect(widgetLabel(node, widgets[3] as UIWidget)).toBe('LoRA 2');
        expect(widgetLabel(node, widgets[4] as UIWidget)).toBe('LoRA 3');
        expect(widgetLabel(node, widgets[5] as UIWidget)).toBe('—');
        expect(widgetLabel(node, widgets[6] as UIWidget)).toBe('➕ Add Lora');
    });

    it('falls back to #N for unregistered node types', async () => {
        const { widgetLabel } = await import('./components/utils');
        const widget = { value: 'x', index: 3 } as UIWidget;
        const node = { id: '7', classType: 'TotallyUnknownNode', widgets: [widget] } as unknown as UINode;
        expect(widgetLabel(node, widget)).toBe('#4');
    });
});
