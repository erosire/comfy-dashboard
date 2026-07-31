// WorkflowActionBar — sits at the bottom of the node list, below the
// JSON/PROMPT tabs. Delete on the left (JSON tab only — the PROMPT tab
// omits it); Copy (JSON tab only — it copies the workflow json for
// pasting into ComfyUI), Clone, then Save on the right. Hidden on the
// OUTPUT tab, where none of the actions apply. The pod run controls
// (#N) live in the footer, immediately left of Generate.
//
// Extracted verbatim from the original CloudTab.tsx.

import React from 'react';
import { Btn, BtnDanger } from './ui';

export type WorkflowActionBarProps = {
    saving: boolean;
    onSave: () => void;
    /** Omit to hide the Delete button (e.g. on the PROMPT tab). */
    onDelete?: () => void;
    /** Copies the raw workflow json to the clipboard for pasting into
        ComfyUI. Only offered on the JSON tab; sits left of Clone. */
    onCopy?: () => void;
    /** Clones the workflow WITH the current page state (unsaved edits
        included). Sits immediately left of Save. */
    onClone: () => void;
};

export const WorkflowActionBar: React.FC<WorkflowActionBarProps> = ({ saving, onSave, onDelete, onCopy, onClone }) => (
    <div
        style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap' as const,
            marginTop: 12
        }}
    >
        {/* Delete — destructive action, on the left. Only offered where
            the caller passes onDelete (the JSON tab); the PROMPT tab
            leaves it out. */}
        {onDelete && (
            <BtnDanger
                className="sg-danger"
                onClick={onDelete}
                title="Delete this workflow permanently"
            >
                Delete
            </BtnDanger>
        )}

        <div style={{ flex: '1 1 auto' }} />

        {/* Copy — copy the raw workflow json to the clipboard, for
            pasting into ComfyUI. Only shown on the JSON tab (the caller
            omits onCopy elsewhere); sits left of Clone. */}
        {onCopy && (
            <Btn
                className="sg-hover"
                onClick={onCopy}
                title="Copy the workflow JSON for pasting into ComfyUI"
            >
                Copy
            </Btn>
        )}

        {/* Clone — duplicate the workflow WITH the current page state
            (unsaved widget edits + PROMPT field selection included);
            the clone becomes the loaded workflow. Sits left of Save. */}
        <Btn
            className="sg-hover"
            onClick={onClone}
            title="Clone this workflow including the current (unsaved) edits"
        >
            Clone
        </Btn>

        {/* Save — persist the editor's widget edits back into the
            stored workflow json. */}
        <Btn
            className="sg-hover"
            onClick={onSave}
            disabled={saving}
            title="Save changes to the workflow"
        >
            {saving ? 'Saving…' : 'Save'}
        </Btn>
    </div>
);
