// Shared styled primitives for the workflow dashboard components.
//
// Extracted verbatim from the original CloudTab.tsx — buttons, badges,
// tab buttons, header widgets and the node-card building blocks
// shared by WorkflowNodeCard and SubgraphNodeCard.

import styled from '@emotion/styled';
import { theme } from '../../../styles';

// ── Buttons & badges ──────────────────────────────────────────────────

export const Btn = styled('button')({
    padding: '5px 14px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface1,
    color: theme.textMuted,
    transition: `background-color ${theme.transition}, color ${theme.transition}, border-color ${theme.transition}`
});

export const BtnPrimary = styled('button')({
    padding: '5px 14px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    border: `1px solid ${theme.accent}`,
    backgroundColor: theme.accent,
    color: '#ffffff',
    transition: `background-color ${theme.transition}`
});

// PodButton keeps the queue badge anchored to the button's top-right corner
// while forwarding only native button attributes to the DOM.
export const PodButton = styled(Btn, {
    shouldForwardProp: (prop) => prop !== 'borderStyle' && prop !== 'borderColor'
})<{ borderStyle: 'solid' | 'dashed'; borderColor: string }>(({ borderStyle, borderColor }) => ({
    position: 'relative',
    fontFamily: theme.fontMono,
    borderStyle,
    borderColor
}));

// PodQueueBadge mirrors a compact Material-style status badge: it overlaps
// the control corner and expands horizontally for larger queue counts.
export const PodQueueBadge = styled('span')({
    position: 'absolute',
    top: -8,
    right: -8,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    padding: '0 4px',
    boxSizing: 'border-box',
    borderRadius: 999,
    border: `1px solid ${theme.bg}`,
    backgroundColor: theme.accent,
    color: '#ffffff',
    fontFamily: theme.fontSans,
    fontSize: theme.fontSize.xs,
    fontWeight: 700,
    lineHeight: 1,
    pointerEvents: 'none',
    zIndex: 1
});

export const BtnDanger = styled('button')({
    padding: '5px 14px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    borderRadius: theme.radiusMd,
    cursor: 'pointer',
    border: `1px solid ${theme.dangerBorder}`,
    backgroundColor: theme.dangerSoft,
    color: theme.danger,
    transition: `background-color ${theme.transition}, color ${theme.transition}`
});

export const Badge = styled('span')({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: theme.fontSize.xs,
    color: theme.textDim,
    padding: '2px 8px',
    borderRadius: theme.radiusSm,
    backgroundColor: theme.surface2,
    border: `1px solid ${theme.border}`
});

export const BadgeDot = styled('span')({
    width: 6,
    height: 6,
    borderRadius: '50%',
    flex: '0 0 auto'
});

// TabBtn — a tab-strip item for the content area switcher. The active tab
// gets an accent underline (via the style prop) that overlaps the strip's
// 1px bottom border (marginBottom: -1).
export const TabBtn = styled('button')({
    padding: '6px 14px',
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    border: 'none',
    backgroundColor: 'transparent',
    color: theme.textDim,
    cursor: 'pointer',
    borderBottom: `2px solid transparent`,
    marginBottom: -1,
    transition: `color ${theme.transition}, border-color ${theme.transition}`
});

export const ToggleButton = styled('button')({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    flex: '0 0 auto',
    borderRadius: theme.radiusMd,
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface1,
    color: theme.text,
    cursor: 'pointer',
    fontSize: theme.fontSize.xl,
    lineHeight: 1,
    padding: 0,
    transition: `background-color ${theme.transition}, border-color ${theme.transition}`
});

export const HeaderTitle = styled('span')({
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.text,
    letterSpacing: 0.2,
    whiteSpace: 'nowrap' as const,
    userSelect: 'none' as const
});

// ── Shared layout / feedback ──────────────────────────────────────────

export const EmptyHint = styled('div')({
    padding: '20px 0',
    fontSize: theme.fontSize.sm,
    color: theme.textFaint,
    textAlign: 'center' as const,
    lineHeight: 1.5
});

export const NodeList = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    gap: 8
});

// ── Input rows (connections & widgets) ────────────────────────────────

export const InputRow = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
});

export const InputLabel = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.textDim,
    fontFamily: theme.fontMono,
    minWidth: 80,
    flex: '0 0 auto',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const
});

export const LinkBadge = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.accent2,
    fontFamily: theme.fontMono,
    padding: '1px 5px',
    borderRadius: theme.radiusSm,
    backgroundColor: 'rgba(147, 180, 212, 0.12)',
    border: '1px solid rgba(147, 180, 212, 0.25)'
});

// ── Node card building blocks ─────────────────────────────────────────

export const NodeCard = styled('div')({
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.surface1,
    overflow: 'hidden'
});

export const NodeHeader = styled('div')({
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    backgroundColor: theme.surface2,
    borderBottom: `1px solid ${theme.border}`
});

export const NodeId = styled('span')({
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    fontFamily: theme.fontMono
});

export const NodeClassType = styled('span')({
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.accent
});

// Mode toggle — click to switch a node between active and bypassed. Every
// node header shows one: the control is always visible so the affordance is
// discoverable without a right-click menu (matching ComfyUI's Bypass).
export const ModeToggle = styled('button', {
    shouldForwardProp: (prop) => prop !== 'bypassed'
})<{ bypassed: boolean }>(({ bypassed }) => ({
    fontSize: theme.fontSize.sm,
    fontFamily: 'inherit',
    lineHeight: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 20,
    height: 18,
    color: bypassed ? '#fbbf24' : theme.textFaint,
    backgroundColor: bypassed ? '#fbbf2422' : 'transparent',
    border: `1px solid ${bypassed ? '#fbbf2466' : theme.border}`,
    borderRadius: theme.radiusSm,
    padding: '0 3px',
    cursor: 'pointer',
    opacity: bypassed ? 1 : 0.55,
    '&:hover': {
        opacity: 1,
        borderColor: bypassed ? '#fbbf24' : theme.textFaint
    }
}));

export const NodeInputs = styled('div')({
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4
});
