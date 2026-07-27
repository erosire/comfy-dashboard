// Global stylesheet for the comfy-dashboard.
//
// Provides :hover, :focus, and keyframe classes that the vendored styled()
// helper cannot express. Injected once at boot via main.tsx. Uses class hooks
// (sg-hover, sg-primary, etc.) that styled components attach via className.

import { theme } from './theme';

const ACCENT_SOLID = theme.accent;
const ACCENT_SOLID_HOVER = theme.accentHover;

const sheet = `
/* ---- Shared interactive class hooks ----------------------------------- */

.sg-hover:hover { background-color: ${theme.surface2}; border-color: ${theme.borderStrong}; }
.sg-hover:disabled { opacity: 0.55; cursor: not-allowed; }

.sg-danger:hover { background-color: ${theme.danger}; border-color: ${theme.danger}; color: #ffffff; }
.sg-danger:disabled { opacity: 0.55; cursor: not-allowed; }

.sg-primary { background-color: ${ACCENT_SOLID}; }
.sg-primary:hover { background-color: ${ACCENT_SOLID_HOVER}; }
.sg-primary:active { background-color: ${ACCENT_SOLID}; }
.sg-primary:disabled { opacity: 0.55; cursor: not-allowed; }

.sg-input:focus { outline: none; border-color: ${theme.accent}; background-color: ${theme.surface3}; }
.sg-input:disabled { opacity: 0.55; cursor: not-allowed; }

/* Workflow item — unselected rows get a flat solid hover surface. */
.sg-workflow-item:hover { background-color: ${theme.surface2}; }

/* Selected workflow — flat solid accent with left rail. */
.sg-workflow-selected {
    position: relative;
    overflow: hidden;
    background-color: ${theme.accent};
    color: #ffffff;
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.10);
}
.sg-workflow-selected:hover {
    background-color: ${theme.accentHover};
}
.sg-workflow-selected::before {
    content: "";
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 3px;
    background: #c7cdfc;
}

/* Collapsible header — flat hover surface swap. */
.sg-collapse-header:hover { background-color: ${theme.surface2}; }

/* ---- Keyframes ------------------------------------------------------- */

@keyframes sg-spin {
    to { transform: rotate(360deg); }
}
.sg-spinner {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid rgba(129, 140, 248, 0.30);
    border-top-color: ${theme.accent};
    border-radius: 50%;
    animation: sg-spin 700ms linear infinite;
}

@keyframes sg-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
}
.sg-fade-in { animation: sg-fade-in 160ms ease both; }

/* Scrollbar styling. */
.sg-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
.sg-scroll::-webkit-scrollbar-track { background: transparent; }
.sg-scroll::-webkit-scrollbar-thumb {
    background: ${theme.surface2};
    border: 2px solid transparent;
    border-radius: 8px;
    background-clip: padding-box;
}
.sg-scroll::-webkit-scrollbar-thumb:hover { background: ${theme.surface3}; background-clip: padding-box; }
`;

// Inject the stylesheet into the document head exactly once. Idempotent.
let injected = false;
export function injectGlobalStyles(): void {
    if (injected || typeof document === 'undefined') return;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-cd-styles', '');
    styleEl.textContent = sheet;
    document.head.appendChild(styleEl);
    injected = true;
}
