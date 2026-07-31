// Drop zones for the workflow editor content area.
//
// EditorDropZone — the empty state: the entire area is the drop target.
// DropReplaceInset — the small banner shown while dragging over an
// already-loaded workflow ("Drop to replace workflow").
//
// Extracted verbatim from the original CloudTab.tsx content fragment.

import React from 'react';
import styled from '@emotion/styled';
import { theme } from '../../../styles';

export const EditorAreaEmpty = styled('div')({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    border: `2px dashed ${theme.border}`,
    margin: 14,
    borderRadius: theme.radiusLg,
    cursor: 'pointer',
    transition: `border-color ${theme.transition}, background-color ${theme.transition}`,
    color: theme.textDim,
    fontSize: theme.fontSize.body,
    boxSizing: 'border-box' as const,
    flex: '1 1 auto'
});

export const DropTitle = styled('div')({
    fontSize: theme.fontSize.lg,
    fontWeight: 600,
    color: theme.textMuted
});

export const DropHint = styled('div')({
    fontSize: theme.fontSize.sm,
    color: theme.textDim
});

export type EditorDropZoneProps = {
    dragOver: boolean;
    onDrop: (e: React.DragEvent) => void;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    /** When editing a saved workflow, its name is shown under the hint. */
    editTargetName?: string;
};

export const EditorDropZone: React.FC<EditorDropZoneProps> = ({
    dragOver,
    onDrop,
    onDragOver,
    onDragLeave,
    editTargetName
}) => (
    <EditorAreaEmpty
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        style={dragOver ? { borderColor: theme.accent, backgroundColor: theme.accentSoft } : undefined}
        data-testid="cloud-drop-zone"
    >
        <DropTitle>Drop ComfyUI JSON</DropTitle>
        <DropHint>Drag &amp; drop a .json file to get started.</DropHint>
        {editTargetName !== undefined && (
            <DropHint style={{ marginTop: 8, color: theme.accent }}>
                Currently editing: {editTargetName}
            </DropHint>
        )}
    </EditorAreaEmpty>
);

export const DropReplaceInset: React.FC = () => (
    <EditorAreaEmpty
        style={{
            position: 'relative' as const,
            borderColor: theme.accent,
            backgroundColor: theme.accentSoft,
            minHeight: 80,
            margin: 0,
            padding: 16,
            flex: '0 0 auto'
        }}
    >
        <DropTitle style={{ fontSize: theme.fontSize.body }}>
            Drop to replace workflow
        </DropTitle>
    </EditorAreaEmpty>
);
