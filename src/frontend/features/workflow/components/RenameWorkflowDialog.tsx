// RenameWorkflowDialog — modal for renaming the saved workflow.
// A custom modal is used instead of window.prompt so embedded webviews
// can't silently suppress it. Enter submits; backdrop click / Cancel closes.
//
// Extracted verbatim from the original CloudTab.tsx rename dialog.

import React from 'react';
import { theme } from '../../../styles';
import { Btn, BtnPrimary } from './ui';

export type RenameWorkflowDialogProps = {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onCancel: () => void;
};

export const RenameWorkflowDialog: React.FC<RenameWorkflowDialogProps> = ({ value, onChange, onSubmit, onCancel }) => (
    <div
        style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)'
        }}
        onClick={onCancel}
    >
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                // Use the solid base surface (theme.bg) so the
                // dialog is fully opaque. The theme's surface*
                // tokens are translucent white overlays meant to
                // stack over this solid bg; using them here would
                // let the dashboard show through the modal backdrop.
                backgroundColor: theme.bg,
                border: `1px solid ${theme.border}`,
                borderRadius: theme.radiusLg,
                padding: 20,
                minWidth: 320,
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
            }}
        >
            <div
                style={{
                    fontSize: theme.fontSize.sm,
                    fontWeight: 600,
                    color: theme.text,
                    marginBottom: 12
                }}
            >
                Rename Workflow
            </div>
            <input
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') onSubmit();
                }}
                autoFocus
                style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: theme.fontSize.sm,
                    borderRadius: theme.radiusMd,
                    border: `1px solid ${theme.border}`,
                    backgroundColor: theme.surface1,
                    color: theme.text,
                    outline: 'none',
                    boxSizing: 'border-box' as const
                }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <Btn onClick={onCancel}>Cancel</Btn>
                <BtnPrimary onClick={onSubmit}>Save</BtnPrimary>
            </div>
        </div>
    </div>
);
