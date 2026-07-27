// Centralized design tokens for the comfy-dashboard.
//
// Modern deep dark theme matching the story-generator palette: near-black
// surfaces, indigo/blue accents, crisp hairline borders. Depth via solid
// color blocks + borders — no shadows, gradients, or glow.

export const theme = {
    // Base surface tones.
    bg: '#0b0f17',
    surface1: 'rgba(255, 255, 255, 0.04)',
    surface2: 'rgba(255, 255, 255, 0.07)',
    surface3: 'rgba(255, 255, 255, 0.10)',

    // Border hairlines.
    border: 'rgba(255, 255, 255, 0.15)',
    borderStrong: 'rgba(255, 255, 255, 0.28)',

    // Text tones — dim → bright for hierarchy.
    text: '#f0f2f5',
    textMuted: '#c8cdd8',
    textDim: '#8891a5',
    textFaint: '#77819a',

    // Brand accent — indigo/blue.
    accent: '#818cf8',
    accentHover: '#a5b4fc',
    accentSoft: 'rgba(129, 140, 248, 0.18)',
    accentRing: 'rgba(129, 140, 248, 0.45)',

    // Secondary accent.
    accent2: '#93b4d4',

    // Semantic colors.
    danger: '#f87171',
    dangerSoft: 'rgba(248, 113, 113, 0.15)',
    dangerBorder: 'rgba(248, 113, 113, 0.35)',
    warning: '#fbbf24',
    warningSoft: 'rgba(251, 191, 36, 0.12)',
    success: '#6ee7b7',
    successSoft: 'rgba(110, 231, 183, 0.12)',

    // Radii.
    radiusSm: 6,
    radiusMd: 8,
    radiusLg: 12,

    // Soft elevation — flat design keeps shadows minimal.
    shadowSm: '0 1px 2px rgba(0, 0, 0, 0.4)',
    shadowMd: 'none',
    shadowLg: 'none',

    // Transition curves.
    transitionFast: '120ms ease',
    transition: '160ms ease',
    transitionSlow: '220ms ease',

    // Font stacks.
    fontSans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    fontMono: 'ui-monospace, "Cascadia Code", "Source Code Pro", "JetBrains Mono", monospace',

    // Font sizes — rem-based. Root is 20px (index.html).
    fontSize: {
        xs: '0.625rem',     // ~10px
        sm: '0.6875rem',    // ~11px
        base: '0.75rem',    // ~12px
        md: '0.8125rem',    // ~13px
        body: '0.875rem',   // ~14px — primary body text
        lg: '0.9375rem',    // ~15px
        xl: '1rem',         // ~16px
    } as const
} as const;

// Helper to build a translucent white overlay of a given alpha.
export const surface = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;

// Convenience: a soft accent-tinted glow used as a box-shadow on focus.
export const focusRing = theme.accentRing;
