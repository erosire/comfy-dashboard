// Display formatting helpers shared across the workflow dashboard panes.
//
// Extracted verbatim from the original CloudTab.tsx.

import type { CloudStreamEvent, GenerationSummary } from '../../../../api';
import type { MediaKind } from './types';

/**
 * The dominant media kind of a generation's results, by priority
 * video > audio > image. A generation can emit several kinds at once
 * (e.g. video + audio + image out of one graph); the OUTPUT tab badges
 * it with the "highest" kind present. Returns null when the run produced
 * nothing (pending/failed/no-output) — those rows show no badge.
 */
export function generationMediaKind(gen: Pick<GenerationSummary, 'resultItems'>): MediaKind | null {
    const items = gen.resultItems ?? [];
    if (items.some((item) => item.type === 'video')) return 'video';
    if (items.some((item) => item.type === 'audio')) return 'audio';
    if (items.length > 0) return 'image';
    return null;
}

/** Format an ISO timestamp as a relative time string (e.g. "2m ago"). */
export function formatRelativeTime(isoString: string | null): string {
    if (!isoString) return '';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'just now';
    const seconds = Math.floor(diffMs / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

/** One-line summary of a cloud stream event (for run logs / tooltips). */
export function eventSummary(event: CloudStreamEvent): string {
    switch (event.type) {
        case 'proxy_enqueue':
            return `✓ Enqueued (prompt_id: ${(event.data as any).prompt_id ?? '?'})`;
        case 'proxy_done':
            return `✓ Done`;
        case 'proxy_error':
            return `✗ Proxy error: ${(event.data as any).error ?? JSON.stringify(event.data)}`;
        case 'status':
            return `⟳ Status update`;
        case 'execution_start':
            return `▶ Execution started`;
        case 'execution_cached':
            return `⊞ Cached nodes: ${((event.data as any).nodes ?? []).length}`;
        case 'progress': {
            const d = event.data as any;
            return `● Progress: ${d.value}/${d.max} (node ${d.node})`;
        }
        case 'executing': {
            const d = event.data as any;
            return d.node ? `◆ Executing node ${d.node}` : `◇ Execution complete`;
        }
        case 'executed': {
            const d = event.data as any;
            const imgs = d.output?.images;
            return `◆ Node ${d.node} executed${imgs ? ` → ${imgs.length} image(s)` : ''}`;
        }
        case 'execution_error': {
            const d = event.data as any;
            return `✗ Error in node ${d.node_id} (${d.node_type}): ${d.exception_message}`;
        }
        case 'execution_success':
            return `✓ Execution succeeded`;
        case 'execution_interrupted':
            return `⚠ Execution interrupted`;
        case 'binary':
            return `◉ Binary preview frame`;
        default:
            return `${event.type}`;
    }
}
