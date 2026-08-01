// Generation log flow — opens a generation's .log event trail in the log
// dialog (OUTPUT tab: failed/error generations) and copies it to the
// clipboard. The fetching is on demand (the log lives in its own endpoint,
// not in the summary list), with a sequence guard so a late response for
// a closed/replaced dialog is dropped.

import React from 'react';
import { fetchGenerationLog } from '../../../../api';

export type UseGenerationLogParams = {
    /** API base ("…/v1/comfy") the log endpoint hangs off. */
    baseUrl: string;
    /** Workflow the generations belong to (store.selectedId). */
    workflowId: string | null;
};

export function useGenerationLog({ baseUrl, workflowId }: UseGenerationLogParams) {
    // Id of the generation whose log the dialog shows — null when closed.
    const [logTarget, setLogTarget] = React.useState<string | null>(null);
    const [logText, setLogText] = React.useState('');
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [copied, setCopied] = React.useState(false);

    // Out-of-order guard: each open bumps the sequence; a response that
    // arrives after a close/re-open (stale) is ignored.
    const requestSeq = React.useRef(0);
    const copiedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(
        () => () => {
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
        },
        []
    );

    const openGenerationLog = React.useCallback(
        async (generateId: string) => {
            setLogTarget(generateId);
            setLogText('');
            setError(null);
            setCopied(false);
            const seq = ++requestSeq.current;
            if (!workflowId) {
                setLoading(false);
                setError('No workflow selected');
                return;
            }
            setLoading(true);
            try {
                const { log } = await fetchGenerationLog(baseUrl, workflowId, generateId);
                if (requestSeq.current === seq) setLogText(log);
            } catch (err) {
                if (requestSeq.current === seq) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            } finally {
                if (requestSeq.current === seq) setLoading(false);
            }
        },
        [baseUrl, workflowId]
    );

    const closeGenerationLog = React.useCallback(() => {
        requestSeq.current++; // drop any in-flight response for this dialog
        setLogTarget(null);
    }, []);

    // What the text box displays (and what Copy copies): the log once
    // loaded, a placeholder while loading, the fetch error as a stand-in
    // when the endpoint couldn't be reached.
    const displayText = loading
        ? 'Loading log…'
        : error
          ? `Failed to load the log: ${error}`
          : logText;

    const copyGenerationLog = React.useCallback(async () => {
        if (loading) return;
        try {
            await navigator.clipboard.writeText(displayText);
        } catch {
            // Fallback for non-secure contexts (http over LAN, embedded
            // webviews): a hidden textarea + execCommand('copy').
            const ta = document.createElement('textarea');
            ta.value = displayText;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
            } catch {
                // Best-effort — the text stays selected for manual copy.
            }
            ta.remove();
        }
        setCopied(true);
        if (copiedTimer.current) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    }, [loading, displayText]);

    return {
        logTarget,
        displayText,
        loading,
        copied,
        openGenerationLog,
        closeGenerationLog,
        copyGenerationLog
    };
}
