// Widget & node display helpers for the workflow dashboard.
//
// Registry-aware value coercion (parseInputValue), numeric clamping
// (clampWidgetNumber), tooltip construction (widgetControlTitle) and the
// data-type / node-name display helpers shared by the node cards.

import type { DataType, WidgetDef } from '../../../../../comfy';
import type { UINode } from '../../../../nodes/node-type';
import { MODE_LABELS } from '../../../../nodes/node-type';

/** Format a widget value for display in an editable field. */
export function displayValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    return String(val);
}

/**
 * Clamp (and round) a numeric widget value to the definition's constraints.
 *
 * The common seed maximum (0xffffffffffffffff ≈ 1.8e19) exceeds
 * Number.MAX_SAFE_INTEGER, so clamping against it would silently change
 * large seeds through float precision loss — maxes beyond the safe-integer
 * range are therefore treated as unbounded.
 */
export function clampWidgetNumber(n: number, def: WidgetDef): number {
    let v = n;
    if (typeof def.min === 'number' && Number.isFinite(def.min)) v = Math.max(def.min, v);
    if (typeof def.max === 'number' && def.max <= Number.MAX_SAFE_INTEGER) v = Math.min(def.max, v);
    if (typeof def.round === 'number' && def.round > 0) {
        const decimals = (String(def.round).split('.')[1] ?? '').length;
        v = Number((Math.round(v / def.round) * def.round).toFixed(Math.min(decimals + 2, 10)));
    }
    return v;
}

/**
 * Hover tooltip for a widget control: the registry tooltip plus a compact
 * constraint summary (min/max/step) so numeric bounds are discoverable.
 */
export function widgetControlTitle(def?: WidgetDef): string | undefined {
    if (!def) return undefined;
    const parts: string[] = [];
    if (def.tooltip) parts.push(def.tooltip);
    const range: string[] = [];
    if (typeof def.min === 'number') range.push(`min ${def.min}`);
    if (typeof def.max === 'number') range.push(`max ${def.max}`);
    if (typeof def.step === 'number') range.push(`step ${def.step}`);
    if (range.length > 0) parts.push(`(${range.join(', ')})`);
    return parts.length > 0 ? parts.join(' ') : undefined;
}

export function parseInputValue(raw: string, original: unknown, def?: WidgetDef): unknown {
    // Registry-aware coercion: the widget's declared type wins over the
    // current value's JS type, so an INT field can never store a fractional
    // (or non-numeric) value and a BOOLEAN field always stores a real
    // boolean — regardless of what was loaded from the workflow.
    if (def?.widgetType === 'INT') {
        const n = Number(raw);
        return isNaN(n) ? original : Math.round(n);
    }
    if (def?.widgetType === 'FLOAT') {
        const n = Number(raw);
        return isNaN(n) ? original : n;
    }
    if (def?.widgetType === 'BOOLEAN') {
        return raw.toLowerCase() === 'true' || raw === '1';
    }
    if (typeof original === 'number') {
        const n = Number(raw);
        return isNaN(n) ? original : n;
    }
    if (typeof original === 'boolean') {
        return raw.toLowerCase() === 'true' || raw === '1';
    }
    return raw;
}

/** Display a data type with a color hint based on common ComfyUI types. */
export function dataTypeColor(type: DataType): string {
    const t = typeof type === 'string' ? type : Array.isArray(type) ? type[0] : String(type);
    switch (t) {
        case 'MODEL':
            return '#818cf8'; // accent (indigo)
        case 'CLIP':
            return '#a78bfa'; // purple
        case 'VAE':
            return '#f472b6'; // pink
        case 'CONDITIONING':
            return '#6ee7b7'; // success (green)
        case 'LATENT':
            return '#fbbf24'; // warning (amber)
        case 'IMAGE':
            return '#38bdf8'; // sky blue
        case 'MASK':
            return '#fb923c'; // orange
        case 'STRING':
            return '#c8cdd8'; // text muted
        case 'INT':
            return '#93b4d4'; // accent2
        case 'FLOAT':
            return '#93b4d4';
        case 'BOOLEAN':
            return '#f87171'; // danger (red)
        default:
            return '#8891a5'; // textDim
    }
}

/** Short label for a data type. Truncate long type names. */
export function dataTypeLabel(type: DataType): string {
    if (typeof type === 'string') return type;
    if (Array.isArray(type)) return type.join('|');
    return String(type);
}

/** Icon for the header mode toggle: a dot for active, a no-entry glyph for bypassed. */
export function modeToggleIcon(mode: number): string {
    if (mode === 4) return '⊘';
    if (mode === 0) return '●';
    return MODE_LABELS[mode] ?? `mode ${mode}`;
}

/** Tooltip for the header mode toggle — what clicking it will do. */
export function modeToggleTitle(mode: number): string {
    return mode === 4
        ? 'Bypassed — excluded from the prompt. Click to activate.'
        : 'Active — included in the prompt. Click to bypass (excluded from execution).';
}

/**
 * The displayed node name: the node's own `title` when the workflow gives
 * it one (user-renamed in ComfyUI), else the registry display name, else
 * the raw class type.
 */
export function nodeDisplayName(node: UINode, registryEntry?: { displayName?: string }): string {
    return node.title ?? registryEntry?.displayName ?? node.classType;
}

/** Header tooltip — keeps the real node type discoverable when a custom title is shown. */
export function nodeDisplayNameTitle(node: UINode): string | undefined {
    return node.title != null ? `${node.classType} #${node.id}` : undefined;
}
