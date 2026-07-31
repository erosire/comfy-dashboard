// DeleteGenerationDialog — confirmation modal that guards the destructive
// per-generation Delete action (OUTPUT tab) against accidental clicks. A
// custom modal is used instead of window.confirm, which some embedded
// webviews silently suppress (same pattern as DeleteWorkflowDialog).

import React from 'react';
import { theme } from '../../../styles';
import { Btn, BtnDanger } from './ui';

export type DeleteGenerationDialogProps = {
    /** Id of the generation about to be deleted (quoted in the message). */
    generationId?: string;
    onConfirm: () => void;
    onCancel: () => void;
};

export const DeleteGenerationDialog: React.FC<DeleteGenerationDialogProps> = ({ generationId, onConfirm, onCancel }) => (
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
                // Solid base surface (theme.bg), same as the workflow
                // delete dialog — translucent surface tokens would let
                // the dashboard show through the modal backdrop.
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
                Delete Generation
            </div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.textMuted, lineHeight: 1.5 }}>
                Delete generation {generationId ? `"${generationId}"` : ''} permanently? Its snapshotted
                prompt, results (images/videos) and event log will be removed. A run still in progress
                is not cancelled — it finishes on the pod but stops being recorded. This cannot be undone.
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
