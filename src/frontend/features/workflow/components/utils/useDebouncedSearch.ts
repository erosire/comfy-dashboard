// Debounced search box state — keeps the input responsive while coalescing
// bursts of keystrokes into a single search call (300 ms idle window).
//
// Extracted from the original CloudTab.tsx sidebar search handling.

import React from 'react';

export function useDebouncedSearch(initialValue: string, onSearch: (value: string) => void, delayMs = 300) {
    const [searchText, setSearchText] = React.useState(initialValue);
    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleSearchChange = React.useCallback(
        (value: string) => {
            setSearchText(value);
            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            debounceRef.current = setTimeout(() => {
                onSearch(value);
            }, delayMs);
        },
        [onSearch, delayMs]
    );

    return { searchText, handleSearchChange };
}
