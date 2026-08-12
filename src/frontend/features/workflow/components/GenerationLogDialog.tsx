// GenerationLogDialog — modal that shows a generation's .log event trail
// in a read-only text box with a left-aligned Copy button and retry controls.
// Opened by clicking a failed/error generation on the OUTPUT tab; the whole
// point is digging the run's terminal error out of the server while keeping
// the failed generation's original workflow available for a retry. The
// backdrop is the only dismissal affordance because clicking outside already
// performs the same action as the removed Close button.

import React from 'react';
import { styledComponent } from '@presource/react';
import { theme } from '../../../styles';
import { BtnPrimary, PodButton, PodQueueBadge } from './ui';
import {
    POD_RING_TRACK,
    podButtonLabel,
    podButtonQueueBadge,
    podLetter,
    type PodEntry
} from './utils';

// The overlay owns modal positioning and backdrop dismissal while the panel
// stops bubbling so clicks inside the log or retry controls do not close it.
const GenerationLogOverlay = styledComponent('div', {
    position: 'fixed',
    inset: 0,
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)'
});

// Keep the log surface opaque so the dashboard cannot show through the modal
// panel; the dimensions preserve the existing wide log-reading layout.
const GenerationLogPanel = styledComponent('div', {
    backgroundColor: theme.bg,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusLg,
    padding: 20,
    width: 'min(720px, 92vw)',
    boxSizing: 'border-box',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
});

// Title and identifier styles intentionally stay separate so the generation
// id can retain its truncation behavior without affecting the heading.
const GenerationLogTitle = styledComponent('div', {
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.text,
    marginBottom: 4
});

const GenerationLogIdentifier = styledComponent('div', {
    fontSize: theme.fontSize.xs,
    color: theme.textFaint,
    fontFamily: theme.fontMono,
    marginBottom: 10,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
});

// The textarea remains controlled and read-only; the hook supplies either the
// fetched trail, loading text, or a precise fetch error through displayText.
const GenerationLogText = styledComponent('textarea', {
    display: 'block',
    width: '100%',
    height: 300,
    boxSizing: 'border-box',
    resize: 'vertical',
    padding: 10,
    fontFamily: theme.fontMono,
    fontSize: theme.fontSize.sm,
    lineHeight: 1.5,
    color: theme.text,
    backgroundColor: theme.surface1,
    border: `1px solid ${theme.border}`,
    borderRadius: theme.radiusMd,
    outline: 'none',
    whiteSpace: 'pre'
}) as unknown as React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>>;

// Copy stays as the first child, making it the left-side action. Retry actions
// are grouped on the right so the diagnostic action remains easy to find.
const GenerationLogActions = styledComponent('div', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 14,
    flexWrap: 'wrap'
});

const GenerationRetryActions = styledComponent('div', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap'
});

export type GenerationLogDialogProps = {
    /** Id of the generation whose log is shown (in the title). */
    generationId: string;
    /** What the text box displays (log text, "loading…", or the fetch error). */
    displayText: string;
    /** True while the log is being fetched (Copy stays disabled). */
    loading: boolean;
    /** True briefly after a successful copy (button label feedback). */
    copied: boolean;
    /** Copies the displayed text to the clipboard. */
    onCopy: () => void;
    /** Opens the GPU picker and spawns a new pod for the failed snapshot. */
    onGenerate?: () => void;
    /** Queues the failed snapshot on a selected existing pod. */
    onPodGenerate?: (pod: PodEntry) => void;
    /** Existing server-listed pods that can accept the failed snapshot. */
    pods?: PodEntry[];
    /** Disables retry controls while the failed snapshot is being submitted. */
    actionBusy?: boolean;
    onClose: () => void;
};

export const GenerationLogDialog: React.FC<GenerationLogDialogProps> = ({
    generationId,
    displayText,
    loading,
    copied,
    onCopy,
    onGenerate,
    onPodGenerate,
    pods = [],
    actionBusy = false,
    onClose
}) => {
    // The dialog receives the same server-authoritative pod entries as the
    // footer and viewer, so retry never invents pod state client-side.
    const retryAvailable = Boolean(onGenerate || (onPodGenerate && pods.length > 0));

    return (
        <GenerationLogOverlay data-testid="generation-log-dialog" onClick={onClose}>
            <GenerationLogPanel onClick={(e) => e.stopPropagation()}>
            <GenerationLogTitle>
                Generation Log
            </GenerationLogTitle>
            <GenerationLogIdentifier title={generationId}>
                {generationId}
            </GenerationLogIdentifier>
            <GenerationLogText
                data-testid="generation-log-text"
                readOnly
                value={displayText}
                // The value is driven entirely by props — silence the
                // controlled-input warning without pretending to edit.
                onChange={() => undefined}
            />
            <GenerationLogActions data-testid="generation-log-actions">
                {/* Copy is intentionally the first action so it remains on the
                    left side while retry controls occupy the right side. */}
                <BtnPrimary
                    data-testid="generation-log-copy"
                    className="sg-primary"
                    onClick={onCopy}
                    disabled={loading}
                    title="Copy the log to the clipboard"
                >
                    {copied ? 'Copied ✓' : 'Copy'}
                </BtnPrimary>
                {retryAvailable && (
                    <GenerationRetryActions data-testid="generation-log-retry-actions">
                        {/* Plus delegates GPU choice to the existing picker;
                            the selected GPU then spawns a fresh pod. */}
                        {onGenerate && (
                            <BtnPrimary
                                className="sg-primary"
                                onClick={onGenerate}
                                disabled={actionBusy}
                                title="Spawn a new cloud pod and retry this generation"
                                data-testid="generation-log-generate"
                            >
                                +
                            </BtnPrimary>
                        )}

                        {/* Each existing pod queues the same failed snapshot on
                            its persistent ComfyUI websocket instead of spawning. */}
                        {onPodGenerate && pods.map((pod) => {
                            const isSpawning = pod.status === 'spawning';
                            const inFlight = pod.queue.length;
                            const isLoading = isSpawning || inFlight > 0;
                            const letter = podLetter(pod.podNumber);
                            const borderColor = isLoading
                                ? POD_RING_TRACK
                                : pod.run.status === 'error'
                                  ? theme.dangerBorder
                                  : pod.run.status === 'done'
                                    ? theme.success
                                    : theme.border;
                            return (
                                <PodButton
                                    key={pod.id}
                                    className={isLoading ? 'sg-hover sg-ring-loading' : 'sg-hover'}
                                    onClick={() => onPodGenerate(pod)}
                                    disabled={actionBusy || isSpawning || !pod.pod_url}
                                    title={
                                        isSpawning
                                            ? `Pod ${letter}${pod.gpu ? ` (${pod.gpu})` : ''} — starting up…`
                                            : `Retry this generation on Pod ${letter} over the ComfyUI websocket`
                                    }
                                    borderStyle="solid"
                                    borderColor={borderColor}
                                    data-testid={`generation-log-pod-${pod.podNumber}`}
                                    data-transport="websocket"
                                >
                                    {podButtonLabel(pod, inFlight)}
                                    {podButtonQueueBadge(pod, inFlight) && (
                                        <PodQueueBadge data-testid={`generation-log-pod-queue-badge-${pod.podNumber}`}>
                                            {podButtonQueueBadge(pod, inFlight)}
                                        </PodQueueBadge>
                                    )}
                                </PodButton>
                            );
                        })}
                    </GenerationRetryActions>
                )}
            </GenerationLogActions>
            </GenerationLogPanel>
        </GenerationLogOverlay>
    );
};
