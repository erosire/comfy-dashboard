// GpuSelectDialog — modal shown when pressing "New": the user picks which
// GPU to spawn the cloud pod on. The options are supplied by GET
// /v1/comfy/cloud, whose available_gpus array is derived from the keys of
// runtime/secret/private/modal/comfy.ts on the server.
//
// Follows the same modal shape as DeleteWorkflowDialog (custom modal —
// window.confirm/dialog elements are suppressed by some embedded webviews).

import React from 'react';
import { styledComponent } from '@presource/react';
import { theme } from '../../../styles';
import { BtnPrimary } from './ui';

// The picker uses styledComponent for all fixed overlay/panel presentation so
// the API-provided GPU data remains the only dynamic input in this component.
const GpuOverlay = styledComponent('div', {
    position: 'fixed',
    inset: 0,
    zIndex: 3000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)'
});

// Solid theme surface prevents the dashboard behind the modal from showing
// through the panel while preserving the existing modal visual contract.
const GpuPanel = styledComponent('div', {
    backgroundColor: theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusLg,
    padding: 20,
    minWidth: 320,
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
});

// Separate text and action wrappers keep the dialog layout reusable and avoid
// inline style objects on JSX elements.
const GpuTitle = styledComponent('div', {
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.text,
    marginBottom: 8
});

const GpuDescription = styledComponent('div', {
    fontSize: theme.fontSize.sm,
    color: theme.textMuted,
    lineHeight: 1.5
});

const GpuActions = styledComponent('div', {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 14
});

export type GpuSelectDialogProps = {
    /** The picked API-provided GPU key — handed to the spawn flow. */
    onSelect: (gpu: string) => void;
    onCancel: () => void;
    /** GPU keys returned by GET /v1/comfy/cloud, never a local fallback list. */
    availableGpus: string[];
};

export const GpuSelectDialog: React.FC<GpuSelectDialogProps> = ({ onSelect, onCancel, availableGpus }) => (
    <GpuOverlay
        // The generation preview uses z-index 2000; keep this picker above
        // the preview so its API-provided GPU buttons remain reachable.
        onClick={onCancel}
    >
        <GpuPanel onClick={(e) => e.stopPropagation()}>
            <GpuTitle>
                Spawn New Pod
            </GpuTitle>
            <GpuDescription>
                Select the GPU to spawn the pod on.
            </GpuDescription>
            <GpuActions>
                {availableGpus.length === 0 ? (
                    // An empty result is possible before the first API poll or
                    // when the API has no configured spawners; never invent a
                    // client-side GPU option in either case.
                    <GpuDescription data-testid="gpu-select-empty">No GPUs available.</GpuDescription>
                ) : availableGpus.map((gpu, index) => (
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
            </GpuActions>
        </GpuPanel>
    </GpuOverlay>
);
