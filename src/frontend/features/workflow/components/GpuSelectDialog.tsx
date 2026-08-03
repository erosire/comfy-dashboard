// GpuSelectDialog — modal shown when pressing "New": the user picks which
// GPU to spawn the cloud pod on. The options are hardcoded (GPU_OPTIONS,
// ./utils/constants.ts) and mirror the keys of comfyCloudServiceEndpoint
// (runtime/secret/private/modal/comfy.ts) — the server resolves the picked
// GPU to its spawner server list and falls through them in order.
//
// Follows the same modal shape as DeleteWorkflowDialog (custom modal —
// window.confirm/dialog elements are suppressed by some embedded webviews).

import React from 'react';
import { theme } from '../../../styles';
import { BtnPrimary } from './ui';
import { GPU_OPTIONS } from './utils';

export type GpuSelectDialogProps = {
    /** The picked GPU key ("4090", "B300", …) — handed to the spawn flow. */
    onSelect: (gpu: string) => void;
    onCancel: () => void;
};

export const GpuSelectDialog: React.FC<GpuSelectDialogProps> = ({ onSelect, onCancel }) => (
    <div
        style={{
            position: 'fixed',
            inset: 0,
            // The generation preview uses z-index 2000; keep this picker above
            // the preview so its GPU buttons remain reachable when opened there.
            zIndex: 3000,
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
                // Solid base surface (theme.bg), same as the delete
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
                Spawn New Pod
            </div>
            <div style={{ fontSize: theme.fontSize.sm, color: theme.textMuted, lineHeight: 1.5 }}>
                Select the GPU to spawn the pod on.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                {GPU_OPTIONS.map((gpu, index) => (
                    <BtnPrimary
                        key={gpu}
                        className="sg-primary"
                        onClick={() => onSelect(gpu)}
                        // First option takes keyboard focus — Enter spawns
                        // the most common GPU without reaching for the mouse.
                        autoFocus={index === 0}
                        data-testid={`gpu-select-${gpu}`}
                    >
                        {gpu}
                    </BtnPrimary>
                ))}
            </div>
        </div>
    </div>
);
