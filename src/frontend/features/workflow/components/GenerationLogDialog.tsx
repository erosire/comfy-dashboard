// GenerationLogDialog — modal that shows a generation's .log event trail
// in a read-only text box with a Copy button. Opened by clicking a
// failed/error generation on the OUTPUT tab; the whole point is digging
// the run's terminal error (and the events leading to it) out of the
// server for debugging. Same overlay pattern as the other dialogs —
// backdrop click dismisses, the body stops propagation.

import React from 'react';
import { theme } from '../../../styles';
import { Btn, BtnPrimary } from './ui';

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
    onClose: () => void;
};

export const GenerationLogDialog: React.FC<GenerationLogDialogProps> = ({
    generationId,
    displayText,
    loading,
    copied,
    onCopy,
    onClose
}) => (
    <div
        data-testid="generation-log-dialog"
        style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.5)'
        }}
        onClick={onClose}
    >
        <div
            onClick={(e) => e.stopPropagation()}
            style={{
                // Solid base surface (theme.bg), same as the other dialogs —
                // translucent surface tokens would let the dashboard show
                // through the modal backdrop.
                backgroundColor: theme.bg,
                border: `1px solid ${theme.border}`,
                borderRadius: theme.radiusLg,
                padding: 20,
                // Wide enough for whole log lines, capped by the viewport.
                width: 'min(720px, 92vw)',
                boxSizing: 'border-box',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4)'
            }}
        >
            <div
                style={{
                    fontSize: theme.fontSize.sm,
                    fontWeight: 600,
                    color: theme.text,
                    marginBottom: 4
                }}
            >
                Generation Log
            </div>
            <div
                style={{
                    fontSize: theme.fontSize.xs,
                    color: theme.textFaint,
                    fontFamily: theme.fontMono,
                    marginBottom: 10,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}
                title={generationId}
            >
                {generationId}
            </div>
            <textarea
                data-testid="generation-log-text"
                readOnly
                value={displayText}
                // The value is driven entirely by props — silence the
                // controlled-input warning without pretending to edit.
                onChange={() => undefined}
                style={{
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
                }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <BtnPrimary
                    data-testid="generation-log-copy"
                    className="sg-primary"
                    onClick={onCopy}
                    disabled={loading}
                    title="Copy the log to the clipboard"
                >
                    {copied ? 'Copied ✓' : 'Copy'}
                </BtnPrimary>
                <Btn data-testid="generation-log-close" onClick={onClose} autoFocus>
                    Close
                </Btn>
            </div>
        </div>
    </div>
);
