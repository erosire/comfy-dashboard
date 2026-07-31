// Reactive media-query hook.
//
// The viewer uses inline styles (no CSS media queries), so responsive
// behavior (edge-to-edge mobile layout) is driven from JS. The query is
// evaluated once on mount and kept in sync via the change listener.
// Matches the pattern used in ComfyDashboard.tsx.
//
// Extracted verbatim from the original CloudTab.tsx.

import React from 'react';

export function useMediaQuery(query: string): boolean {
    const [matches, setMatches] = React.useState(() => {
        if (typeof window !== 'undefined' && window.matchMedia) {
            return window.matchMedia(query).matches;
        }
        return false;
    });
    React.useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mql = window.matchMedia(query);
        const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
        mql.addEventListener('change', handler);
        return () => mql.removeEventListener('change', handler);
    }, [query]);
    return matches;
}
