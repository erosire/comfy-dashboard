// DeleteWorkflowDialog — confirmation modal that guards the destructive
// Delete action against accidental clicks (a custom modal is used instead
// of window.confirm, which some embedded webviews silently suppress).
//
// Extracted verbatim from the original CloudTab.tsx delete confirmation.

import React from 'react';
import { theme } from '../../../styles';
import { Btn, BtnDanger } from './ui';

export type DeleteWorkflowDialogProps = {
    /** Name of the workflow about to be deleted (quoted in the message). */
    workflowName?: string;
    onConfirm: () => void;
    onCancel: () => void;
};

export const DeleteWorkflowDialog: React.FC<DeleteWorkflowDialogProps> = ({ workflowName, onConfirm, onCancel }) => (
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
                // Solid base surface (theme.bg), same as the rename
                // dialog — translucent surface tokens would let the
                // dashboard show through the modal backdrop.
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
                    marginBottom: 8
                }}
            >
                Delete Workflow
            </div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.textMuted, lineHeight: 1.5 }}>
                Delete {workflowName ? `"${workflowName}"` : 'this workflow'}{' '}
                permanently? This cannot be undone.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <Btn onClick={onCancel} autoFocus>
                    Cancel
                </Btn>
                <BtnDanger className="sg-danger" onClick={onConfirm}>
                    Delete
                </BtnDanger>
            </div>
        </div>
    </div>
);
