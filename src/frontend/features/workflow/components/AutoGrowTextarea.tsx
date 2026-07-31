// AutoGrowTextarea — auto-growing multi-line field for widget values.
//
// Replaces the previous single-line <input> so prompt-style widgets can span
// multiple lines. The field grows to fit its content (pressing Enter inserts
// a newline) and re-fits when the value or the field's width changes. It is
// capped at 8 visible rows (8 × 1.4em line-height + 6px vertical padding,
// border-box); beyond that the field scrolls internally.
//
// Also supports pasting an image from the clipboard as a base64 data: URL —
// mirrors the UniversalDataToImage node's universal_data_input.js: when the
// clipboard holds an image, convert it to a data URI and write it into the
// field (replacing the value) via onChange so the parent state updates.
//
// Extracted verbatim from the original CloudTab.tsx.

import React from 'react';
import styled from '@emotion/styled';
import { theme } from '../../../styles';

export const WidgetTextarea = styled('textarea')({
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
    boxSizing: 'border-box' as const,
    resize: 'none' as const,
    overflowY: 'auto' as const,
    lineHeight: 1.4,
    height: 'auto',
    // 8 rows × 1.4em line-height + 6px vertical padding (border-box).
    maxHeight: 'calc(8 * 1.4em + 6px)'
});

export const AutoGrowTextarea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = (props) => {
    const ref = React.useRef<HTMLTextAreaElement | null>(null);
    const lastWidthRef = React.useRef(0);

    // Keep the latest onChange/onPaste in refs so the (stable) paste handler
    // always invokes the freshest callbacks without re-attaching listeners.
    const onChangeRef = React.useRef(props.onChange);
    onChangeRef.current = props.onChange;
    const onPasteRef = React.useRef(props.onPaste);
    onPasteRef.current = props.onPaste;

    const resize = React.useCallback(() => {
        const el = ref.current;
        if (!el) return;
        // Collapse first so scrollHeight reflects the true content height
        // (works for both growing and shrinking as text is added/removed).
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, []);

    // Re-fit on every value change: typing, external updates, workflow swap.
    React.useLayoutEffect(() => {
        resize();
    }, [props.value, resize]);

    // Re-fit when the field's width changes (sidebar toggle, window resize),
    // since wrapped line counts change with width. Ignore height-only changes
    // (caused by our own resize) to avoid an observer feedback loop.
    React.useEffect(() => {
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const w = entry.contentRect.width;
                if (Math.abs(w - lastWidthRef.current) > 0.5) {
                    lastWidthRef.current = w;
                    resize();
                }
            }
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, [resize]);

    // Paste an image from the clipboard as a base64 data: URL — mirrors the
    // UniversalDataToImage node's universal_data_input.js: when the clipboard
    // holds an image, convert it to a data URI and write it into the field
    // (replacing the value) via onChange so the parent state updates. This
    // applies to every widget-value field (subgraph + main node cards) since
    // they all render through this component. Non-image pastes fall through to
    // the browser's default text behaviour (and any caller-supplied onPaste),
    // so plain text / URLs still paste normally.
    const handlePaste = React.useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (items) {
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    const blob = items[i].getAsFile();
                    if (blob) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            const dataUri = ev.target?.result;
                            if (typeof dataUri === 'string') {
                                onChangeRef.current?.({
                                    target: { value: dataUri }
                                } as React.ChangeEvent<HTMLTextAreaElement>);
                            }
                        };
                        reader.readAsDataURL(blob);
                    }
                    return;
                }
            }
        }
        // No image in the clipboard — defer to the caller's onPaste (if any)
        // and otherwise let the default text paste proceed unchanged.
        onPasteRef.current?.(e);
    }, []);

    return <WidgetTextarea ref={ref} rows={1} {...props} onPaste={handlePaste} />;
};
