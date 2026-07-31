// WorkflowActionBar — sits at the bottom of the node list, below the
// JSON/PROMPT tabs. Delete on the left, Save on the right. Hidden on the
// OUTPUT tab, where neither action applies. The pod run controls (#N)
// live in the footer, immediately left of Generate.
//
// Extracted verbatim from the original CloudTab.tsx.

import React from 'react';
import { Btn, BtnDanger } from './ui';

export type WorkflowActionBarProps = {
    saving: boolean;
    onSave: () => void;
    onDelete: () => void;
};

export const WorkflowActionBar: React.FC<WorkflowActionBarProps> = ({ saving, onSave, onDelete }) => (
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
        {/* Delete — destructive action, on the left */}
        <BtnDanger
            className="sg-danger"
            onClick={onDelete}
            title="Delete this workflow permanently"
        >
            Delete
        </BtnDanger>

        <div style={{ flex: '1 1 auto' }} />

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
