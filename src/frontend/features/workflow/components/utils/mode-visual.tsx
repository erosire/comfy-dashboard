// Header mode-toggle VISUAL — the React node rendered inside a node card's
// ModeToggle button.
//
// The former helper (modeToggleIcon) returned a glyph STRING ('●' active /
// '⊘' bypassed) rendered as text; UI icons are now inline SVG from
// @rightless/icons, so this helper maps the node mode to the icon component
// and falls back to the mode's text label for exotic modes. The string
// helper stays in widget-utils.ts (width math / text contexts still consume
// glyph labels there).
import React from 'react';
import { DotIcon, BanIcon } from '@rightless/icons';
import { MODE_LABELS } from '@underload/comfy';

export function modeToggleVisual(mode: number): React.ReactNode {
    // bypassed → ban (no-entry) glyph
    if (mode === 4) return <BanIcon size={12} />;
    // active → filled dot
    if (mode === 0) return <DotIcon size={12} />;
    return MODE_LABELS[mode] ?? `mode ${mode}`;
}
