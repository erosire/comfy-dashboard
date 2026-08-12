// ── Registry-driven widget controls ─────────────────────────────────────
//
// Every widget on a registered node has a WidgetDef in the node registry
// describing its type and constraints (COMBO options, numeric min/max/step,
// slider display, multiline text, etc.). WidgetValueEditor picks the right
// control for the definition so the UI restricts input to what the node
// actually accepts — dropdowns for COMBO, clamped number fields (or a
// slider + number pair) for INT/FLOAT, a toggle for BOOLEAN, and text for
// everything else.
//
// Extracted verbatim from the original CloudTab.tsx.

import React from 'react';
import styled from '@emotion/styled';
import { theme } from '../../../styles';
import type { WidgetDef } from '@underload/comfy';
import {
    comfyNodeRegistry,
    POWER_LORA_LOADER_NODE_TYPE,
    POWER_LORA_LOADER_SEPARATE_STRENGTHS,
    isPowerLoraEntry,
    isPowerLoraHeader,
    type PowerLoraEntry
} from '@underload/comfy';
import type { UINode, UIWidget } from '../../../nodes/node-type';
import { AutoGrowTextarea } from './AutoGrowTextarea';
import { Badge } from './ui';
import {
    clampWidgetNumber,
    displayValue,
    formatByteSize,
    parseBase64DataUri,
    widgetControlTitle
} from './utils';

// WidgetSelect — dropdown for COMBO widgets whose registry definition
// carries a fixed options list (e.g. ResolutionSelector's aspect ratios, or
// KSampler's sampler/scheduler names). Mirrors the WidgetTextarea styling
// so all widget controls on a card line up.
export const WidgetSelect = styled('select')({
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
    cursor: 'pointer',
    // Keep the native dropdown list readable on the dark theme.
    '& option': {
        backgroundColor: '#131a26',
        color: theme.text
    }
});

// WidgetNumberField — constrained input for INT/FLOAT widgets. min/max/step
// attributes come from the registry definition so the native spinners and
// validation restrict what can be typed.
export const WidgetNumberField = styled('input')({
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
    boxSizing: 'border-box' as const
});

// WidgetTextField — single-line text input for structured editors that need
// a compact inline field (e.g. the Power Lora Loader's lora filename), where
// the multi-line AutoGrowTextarea would be the wrong control.
export const WidgetTextField = styled('input')({
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
    boxSizing: 'border-box' as const
});

// WidgetRangeInput — slider for numeric widgets whose registry display mode
// is "slider" (e.g. KSampler cfg / denoise). Always paired with a number
// field so the exact value stays visible and editable.
export const WidgetRangeInput = styled('input')({
    flex: '1 1 auto',
    minWidth: 0,
    accentColor: theme.accent,
    cursor: 'pointer'
});

// WidgetBoolToggle — click-to-toggle control for BOOLEAN widgets (e.g.
// ComfySwitchNode's switch). Shows the current state explicitly — greenish
// when true, muted when false — like ComfyUI's own toggle widget.
export const WidgetBoolToggle = styled('button', {
    shouldForwardProp: (prop) => prop !== 'active'
})<{ active: boolean }>(({ active }) => ({
    flex: '0 0 auto',
    padding: '3px 10px',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    fontWeight: 600,
    borderRadius: theme.radiusSm,
    cursor: 'pointer',
    color: active ? theme.success : theme.textDim,
    backgroundColor: active ? theme.successSoft : theme.surface3,
    border: `1px solid ${active ? theme.success : theme.border}`,
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`
}));

// DataUriPreview — the single-line, ellipsized stand-in for a base64 data:
// URI value. Styled like the free-text field so the row lines up with the
// other controls, but read-only and never holding the payload text.
const DataUriPreview = styled('span')({
    flex: '1 1 auto',
    padding: '3px 6px',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    color: theme.textDim,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    minWidth: 0,
    boxSizing: 'border-box' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const
});

// DataUriAction — compact ghost button for the base64 row (raw toggle / ✕
// clear). Mirrors the ModeToggle ghost look used on node headers.
const DataUriAction = styled('button')({
    flex: '0 0 auto',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 20,
    padding: '0 6px',
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fontMono,
    lineHeight: 1,
    color: theme.textDim,
    backgroundColor: theme.surface3,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusSm,
    cursor: 'pointer',
    '&:hover': {
        color: theme.text,
        borderColor: theme.textFaint
    }
});

/**
 * Compact editor for a widget value that IS a base64 `data:` URI (e.g. an
 * image pasted into UniversalDataToImage's data_uri field).
 *
 * Rendering the raw payload into the editable textarea stalls the browser
 * (multi-megabyte single-line text → layout/paint crawl) and carries no
 * usable information, so the default view is a one-line ellipsized header
 * stating it is base64 (`data:<mime>;base64,` + payload preview), plus a
 * badge with the mime type and decoded size. "raw" swaps in the full
 * editable textarea on explicit demand; ✕ clears the value (turning the
 * field back into the plain free-text editor, ready for a fresh paste).
 */
const Base64DataUriValue: React.FC<{
    text: string;
    node: UINode;
    widget: UIWidget;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    placeholder?: string;
    testId?: string;
}> = ({ text, node, widget, updateNodeWidget, placeholder, testId }) => {
    const [showRaw, setShowRaw] = React.useState(false);
    const parsed = parseBase64DataUri(text);

    // Value changed away from a base64 URI (cleared / replaced) — fall back
    // out of raw mode so the compact view comes back for the next payload.
    React.useEffect(() => {
        if (!parsed) setShowRaw(false);
    }, [parsed]);

    if (!parsed) return null;

    if (showRaw) {
        return (
            <>
                <AutoGrowTextarea
                    value={text}
                    onChange={(e) => updateNodeWidget(node.id, widget.index, e.target.value)}
                    readOnly={false}
                    placeholder={placeholder}
                    title="Full base64 payload — large values make this field slow to render"
                    data-testid={testId}
                />
                <DataUriAction
                    type="button"
                    onClick={() => setShowRaw(false)}
                    title="Back to the compact base64 summary"
                    data-testid={testId ? `${testId}-collapse` : undefined}
                >
                    ▾
                </DataUriAction>
            </>
        );
    }

    const summary = `base64 ${parsed.mime || 'data'} · ≈${formatByteSize(parsed.byteSize)}`;
    return (
        <>
            <DataUriPreview
                title={`${summary} — compact display; "raw" shows the full payload, ✕ clears it`}
                data-testid={testId ? `${testId}-datauri` : undefined}
            >
                {text.length > 64 ? `${text.substring(0, 64)}…` : text}
            </DataUriPreview>
            <Badge title="base64-encoded payload (mime · decoded size)">{summary}</Badge>
            <DataUriAction
                type="button"
                onClick={() => setShowRaw(true)}
                title="Show the full base64 payload (may be slow for large payloads)"
                data-testid={testId ? `${testId}-raw` : undefined}
            >
                raw
            </DataUriAction>
            <DataUriAction
                type="button"
                onClick={() => updateNodeWidget(node.id, widget.index, '')}
                title="Clear the base64 payload"
                data-testid={testId ? `${testId}-clear` : undefined}
            >
                ✕
            </DataUriAction>
        </>
    );
};

// ── Power Lora Loader (rgthree) dedicated editors ────────────────────────
//
// The node's object widget values are not opaque JSON blobs — they have a
// fixed shape (src_web/comfyui/power_lora_loader.ts), so they get real
// controls instead of a JSON document:
//
//   lora entry  {on, lora, strength, strengthTwo}  → toggle + filename +
//                                                     strength field(s)
//   header      {type: "PowerLoraLoaderHeaderWidget"} → toggle-all control
//   dividers    {}                                  → (handled above as ⋯)
//
// `strengthTwo` is the CLIP strength and only exists when the node's
// "Show Strengths" property is "Separate Model & Clip" — in single-strength
// mode it stays null and is never sent to the prompt, so the editor hides
// it (mirroring rgthree's own canvas row).
//
// All edits commit the whole entry object as JSON text; parseInputValue
// re-parses it into a real object so tree/prompt/save round-trip intact.

/**
 * One lora row: on/off toggle, lora filename, strength — plus a clip
 * strength field when the node is in "Separate Model & Clip" mode (or a
 * saved strengthTwo value exists). Post-toggle controls dim when the entry
 * is off, mirroring rgthree's canvas rendering.
 */
const PowerLoraEntryEditor: React.FC<{
    node: UINode;
    widget: UIWidget;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    title?: string;
    testId?: string;
}> = ({ node, widget, updateNodeWidget, title, testId }) => {
    const entry = widget.value as PowerLoraEntry;
    const on = entry.on !== false;
    const lora = typeof entry.lora === 'string' ? entry.lora : '';
    const strength = typeof entry.strength === 'number' ? entry.strength : 1;

    // Show the second (clip) strength only in separate mode, or when the
    // saved value already carries a real number; rgthree initializes a null
    // strengthTwo to the model strength when the mode is switched on.
    const separate = node.properties?.['Show Strengths'] === POWER_LORA_LOADER_SEPARATE_STRENGTHS;
    const showStrengthTwo = separate || typeof entry.strengthTwo === 'number';
    const strengthTwo = typeof entry.strengthTwo === 'number' ? entry.strengthTwo : strength;

    const commit = (patch: Partial<PowerLoraEntry>) =>
        updateNodeWidget(node.id, widget.index, JSON.stringify({ ...entry, ...patch }));

    // Strength fields: valid numbers commit immediately; an emptied field
    // is left uncommitted so the user can retype from scratch (same rule
    // as NumberWidgetEditor's blur handling).
    const commitNumber = (key: 'strength' | 'strengthTwo') => (e: React.ChangeEvent<HTMLInputElement>) => {
        const raw = e.target.value;
        if (raw.trim() === '') return;
        const n = Number(raw);
        if (isNaN(n)) return;
        commit({ [key]: n } as Partial<PowerLoraEntry>);
    };

    const dimmed = on ? undefined : 0.45;
    return (
        <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <WidgetBoolToggle
                type="button"
                active={on}
                onClick={() => commit({ on: !on })}
                title={on ? 'LoRA enabled — click to disable' : 'LoRA disabled — click to enable'}
                data-testid={testId ? `${testId}-toggle` : undefined}
            >
                {on ? 'on' : 'off'}
            </WidgetBoolToggle>
            <WidgetTextField
                type="text"
                value={lora}
                placeholder="None"
                onChange={(e) => commit({ lora: e.target.value })}
                title={title ?? 'LoRA filename'}
                style={{ opacity: dimmed }}
                data-testid={testId}
            />
            <WidgetNumberField
                type="number"
                step={0.05}
                style={{ flex: '0 0 auto', width: 76, opacity: dimmed }}
                value={displayValue(strength)}
                onChange={commitNumber('strength')}
                title={showStrengthTwo ? 'Model strength' : 'Strength (model & clip)'}
                data-testid={testId ? `${testId}-strength` : undefined}
            />
            {showStrengthTwo && (
                <WidgetNumberField
                    type="number"
                    step={0.05}
                    style={{ flex: '0 0 auto', width: 76, opacity: dimmed }}
                    value={displayValue(strengthTwo)}
                    onChange={commitNumber('strengthTwo')}
                    title="Clip strength"
                    data-testid={testId ? `${testId}-strengthTwo` : undefined}
                />
            )}
        </div>
    );
};

/**
 * The PowerLoraLoaderHeaderWidget: rgthree renders a "Toggle All" switch
 * plus the strength column captions. The toggle flips every lora entry on
 * the node (mirroring rgthree's toggleAllLoras: anything off → all on,
 * all on → all off), committing one update per affected entry.
 */
const PowerLoraHeaderEditor: React.FC<{
    node: UINode;
    widget: UIWidget;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    title?: string;
    testId?: string;
}> = ({ node, updateNodeWidget, title, testId }) => {
    const loraWidgets = node.widgets.filter((w) => isPowerLoraEntry(w.value));
    const allOn = loraWidgets.length > 0 && loraWidgets.every((w) => (w.value as PowerLoraEntry).on !== false);
    const allOff = loraWidgets.length > 0 && loraWidgets.every((w) => (w.value as PowerLoraEntry).on === false);

    const toggleAll = () => {
        const target = !allOn;
        for (const w of loraWidgets) {
            const entry = w.value as PowerLoraEntry;
            if ((entry.on !== false) !== target) {
                updateNodeWidget(node.id, w.index, JSON.stringify({ ...entry, on: target }));
            }
        }
    };

    const separate = node.properties?.['Show Strengths'] === POWER_LORA_LOADER_SEPARATE_STRENGTHS;
    return (
        <>
            <WidgetBoolToggle
                type="button"
                active={allOn}
                onClick={toggleAll}
                title={title ?? 'Toggle every LoRA on this node'}
                data-testid={testId}
            >
                {allOn ? '● all on' : allOff ? '○ all off' : '◐ mixed'}
            </WidgetBoolToggle>
            <DataUriPreview title="Column header (read-only)">
                {separate ? 'model · clip' : 'strength'}
            </DataUriPreview>
        </>
    );
};

/**
 * Editor for STRUCTURED widget values — plain objects (rgthree Power Lora
 * Loader's lora entries `{on, lora, strength, strengthTwo}` and its header
 * widget, divider spacers `{}`, etc.). Raw `String(value)` renders as the
 * useless "[object Object]", so object values instead get a compact summary
 * plus a JSON text editor.
 *
 * rgthree Power Lora Loader values route to dedicated per-shape editors
 * (see above); anything else falls back to a draft-based JSON editor: the
 * textarea holds a local JSON draft and only drafts that JSON.parse cleanly
 * are committed to the tree (parseInputValue re-parses into a real object),
 * so a half-typed document never clobbers the stored value. An invalid
 * draft gets a red border. Empty objects (rgthree's divider spacers) render
 * as a read-only placeholder line.
 */
const ObjectWidgetEditor: React.FC<{
    node: UINode;
    widget: UIWidget;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    title?: string;
    testId?: string;
}> = ({ node, widget, updateNodeWidget, title, testId }) => {
    const value = widget.value;
    const keys =
        value && typeof value === 'object' && !Array.isArray(value)
            ? Object.keys(value as Record<string, unknown>)
            : [];

    // Divider spacer ({}) — pure layout machinery, nothing to edit.
    if (keys.length === 0) {
        return (
            <DataUriPreview title="Layout spacer (no editable value)" data-testid={testId}>
                ⋯
            </DataUriPreview>
        );
    }

    // Power Lora Loader's known object shapes get dedicated controls.
    if (isPowerLoraEntry(value)) {
        return (
            <PowerLoraEntryEditor
                node={node}
                widget={widget}
                updateNodeWidget={updateNodeWidget}
                title={title}
                testId={testId}
            />
        );
    }
    if (isPowerLoraHeader(value)) {
        return (
            <PowerLoraHeaderEditor
                node={node}
                widget={widget}
                updateNodeWidget={updateNodeWidget}
                title={title}
                testId={testId}
            />
        );
    }

    return <JsonObjectDraftEditor node={node} widget={widget} updateNodeWidget={updateNodeWidget} title={title} testId={testId} />;
};

/** Draft-JSON editor for non-empty object widget values. */
const JsonObjectDraftEditor: React.FC<{
    node: UINode;
    widget: UIWidget;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    title?: string;
    testId?: string;
}> = ({ node, widget, updateNodeWidget, title, testId }) => {
    const serialized = React.useMemo(() => JSON.stringify(widget.value, null, 2) ?? '', [widget.value]);
    const [draft, setDraft] = React.useState(serialized);
    const [editing, setEditing] = React.useState(false);

    // External value changes (workflow load, other-tab edit) reset the draft.
    React.useEffect(() => {
        if (!editing) setDraft(serialized);
    }, [serialized, editing]);

    // Compact one-line summary for the collapsed view.
    const summary = React.useMemo(() => {
        const flat = JSON.stringify(widget.value);
        return flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
    }, [widget.value]);

    const isValid = React.useMemo(() => {
        try {
            JSON.parse(draft);
            return true;
        } catch {
            return false;
        }
    }, [draft]);

    const commit = (text: string) => {
        setDraft(text);
        try {
            JSON.parse(text);
            updateNodeWidget(node.id, widget.index, text);
        } catch {
            // Invalid intermediate draft — keep it local only.
        }
    };

    if (!editing) {
        return (
            <>
                <DataUriPreview title={title ?? 'Structured widget value'} data-testid={testId}>
                    {summary}
                </DataUriPreview>
                <DataUriAction
                    type="button"
                    onClick={() => setEditing(true)}
                    title="Edit as JSON"
                    data-testid={testId ? `${testId}-json` : undefined}
                >
                    json
                </DataUriAction>
            </>
        );
    }

    return (
        <>
            <AutoGrowTextarea
                value={draft}
                onChange={(e) => commit(e.target.value)}
                readOnly={false}
                title={
                    (title ? `${title} — ` : '') +
                    (isValid ? 'JSON — edits apply immediately' : 'Invalid JSON — not applied yet')
                }
                style={isValid ? undefined : { borderColor: theme.danger }}
                data-testid={testId ? `${testId}-draft` : undefined}
            />
            <DataUriAction
                type="button"
                onClick={() => {
                    if (isValid) {
                        setEditing(false);
                        setDraft(serialized);
                    } else {
                        // Discard the invalid draft and leave edit mode.
                        setEditing(false);
                        setDraft(serialized);
                    }
                }}
                title={isValid ? 'Done editing' : 'Discard invalid JSON'}
                data-testid={testId ? `${testId}-done` : undefined}
            >
                {isValid ? '▾' : '✕'}
            </DataUriAction>
        </>
    );
};

/** Number (and slider) editor for INT/FLOAT widgets. */
export const NumberWidgetEditor: React.FC<{
    node: UINode;
    widget: UIWidget;
    def: WidgetDef;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    testId?: string;
}> = ({ node, widget, def, updateNodeWidget, testId }) => {
    const title = widgetControlTitle(def);
    const isInt = def.widgetType === 'INT';
    // FLOAT fields default to step "any" — the browser's implicit step=1
    // would otherwise flag every decimal value as invalid.
    const step: number | 'any' = def.step ?? (isInt ? 1 : 'any');
    const current = typeof widget.value === 'number' ? widget.value : Number(widget.value);

    // Commit the raw string — parseInputValue coerces via the registry def
    // so INT widgets always store integers.
    const commitRaw = (raw: string) => updateNodeWidget(node.id, widget.index, raw);

    // Commit with constraints applied (slider moves and blur). Empty fields
    // are left alone so the user can retype from scratch.
    const commitConstrained = (raw: string) => {
        if (raw.trim() === '') return;
        const n = Number(raw);
        if (isNaN(n)) return;
        commitRaw(String(clampWidgetNumber(n, def)));
    };

    // Slider layout when the registry asks for it and has a usable finite
    // range: a range track plus a compact number field showing the value.
    const useSlider =
        def.display === 'slider' &&
        typeof def.min === 'number' &&
        typeof def.max === 'number' &&
        def.max > def.min &&
        def.max <= Number.MAX_SAFE_INTEGER;

    if (useSlider) {
        const sliderValue = Number.isFinite(current) ? clampWidgetNumber(current, def) : (def.min as number);
        return (
            <div style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <WidgetRangeInput
                    type="range"
                    min={def.min}
                    max={def.max}
                    step={step === 'any' ? 'any' : step}
                    value={sliderValue}
                    onChange={(e) => commitConstrained(e.target.value)}
                    title={title}
                    data-testid={testId ? `${testId}-slider` : undefined}
                />
                <WidgetNumberField
                    type="number"
                    style={{ flex: '0 0 auto', width: 76 }}
                    min={def.min}
                    max={def.max}
                    step={step}
                    value={displayValue(widget.value)}
                    onChange={(e) => commitRaw(e.target.value)}
                    onBlur={(e) => commitConstrained(e.target.value)}
                    title={title}
                    data-testid={testId}
                />
            </div>
        );
    }

    return (
        <WidgetNumberField
            type="number"
            min={def.min}
            max={typeof def.max === 'number' && def.max <= Number.MAX_SAFE_INTEGER ? def.max : undefined}
            step={step}
            value={displayValue(widget.value)}
            onChange={(e) => commitRaw(e.target.value)}
            onBlur={(e) => commitConstrained(e.target.value)}
            title={title}
            data-testid={testId}
        />
    );
};

/**
 * Picks the widget control that matches the node's registry definition.
 * Unregistered nodes and registry widgets without constraints fall back to
 * the free-text field (previous behaviour for every widget).
 *
 * Exported for component-level tests.
 */
export const WidgetValueEditor: React.FC<{
    node: UINode;
    widget: UIWidget;
    updateNodeWidget: (nodeId: string, widgetIdx: number, rawValue: string) => void;
    testId?: string;
}> = ({ node, widget, updateNodeWidget, testId }) => {
    const def = comfyNodeRegistry[node.classType]?.widgets[widget.index];
    const title = widgetControlTitle(def);

    // COMBO with a fixed option list → dropdown. A current value that isn't
    // in the list (stale workflow, renamed file) is kept as an extra option
    // so the select displays it instead of snapping to the first entry.
    // COMBOs with an EMPTY option list (e.g. LoadImage's image picker, whose
    // choices are populated at runtime from the server) keep the free-text
    // field.
    if (def?.widgetType === 'COMBO' && def.options && def.options.length > 0) {
        const current = displayValue(widget.value);
        const options = def.options.includes(current) ? def.options : [current, ...def.options];
        return (
            <WidgetSelect
                value={current}
                onChange={(e) => updateNodeWidget(node.id, widget.index, e.target.value)}
                title={title}
                data-testid={testId}
            >
                {options.map((opt) => (
                    <option key={opt} value={opt}>
                        {opt}
                    </option>
                ))}
            </WidgetSelect>
        );
    }

    // INT / FLOAT → number input with min/max/step (slider variant when the
    // registry display mode asks for one).
    if (def?.widgetType === 'INT' || def?.widgetType === 'FLOAT') {
        return (
            <NumberWidgetEditor
                node={node}
                widget={widget}
                def={def}
                updateNodeWidget={updateNodeWidget}
                testId={testId}
            />
        );
    }

    // BOOLEAN → click-to-toggle button showing the current state.
    if (def?.widgetType === 'BOOLEAN') {
        const on = widget.value === true || widget.value === 'true' || widget.value === 1;
        return (
            <WidgetBoolToggle
                type="button"
                active={on}
                onClick={() => updateNodeWidget(node.id, widget.index, on ? 'false' : 'true')}
                title={title ?? (on ? 'true — click to switch off' : 'false — click to switch on')}
                data-testid={testId}
            >
                {on ? 'true' : 'false'}
            </WidgetBoolToggle>
        );
    }

    // Structured (plain-object) values — rgthree lora entries, header
    // objects, divider spacers — get the JSON object editor instead of the
    // useless "[object Object]" text.
    if (widget.value !== null && typeof widget.value === 'object' && !Array.isArray(widget.value)) {
        return (
            <ObjectWidgetEditor
                node={node}
                widget={widget}
                updateNodeWidget={updateNodeWidget}
                title={title}
                testId={testId}
            />
        );
    }

    // Power Lora Loader's trailing "➕ Add Lora" button serializes as an
    // empty string — it is a row-adding button in ComfyUI, not an editable
    // field, so show a read-only hint instead of a pointless text box.
    if (node.classType === POWER_LORA_LOADER_NODE_TYPE && typeof widget.value === 'string') {
        return (
            <DataUriPreview
                title="Adds a new lora row in ComfyUI — not an editable value"
                data-testid={testId}
            >
                ➕ Add Lora — rows are added in ComfyUI
            </DataUriPreview>
        );
    }

    // STRING, IMAGEUPLOAD, dynamic COMBO (empty options) and anything
    // without a registry definition → free-text field (multi-line capable).
    const text = displayValue(widget.value);

    // A base64 data: URI (pasted image/video payloads) gets a compact
    // summary instead of the raw payload in the textarea — multi-megabyte
    // single-line values stall the browser's layout and carry no usable
    // information at a glance.
    if (parseBase64DataUri(text)) {
        return (
            <Base64DataUriValue
                text={text}
                node={node}
                widget={widget}
                updateNodeWidget={updateNodeWidget}
                placeholder={def?.placeholder}
                testId={testId}
            />
        );
    }

    return (
        <AutoGrowTextarea
            value={text}
            onChange={(e) => updateNodeWidget(node.id, widget.index, e.target.value)}
            readOnly={false}
            placeholder={def?.placeholder}
            title={title}
            data-testid={testId}
        />
    );
};
