// ResultViewer media defaults — video previews autoplay silently so opening a
// generated result never unexpectedly plays audio; native controls can unmute.
// Once unmuted, the choice is remembered across remounted videos for the rest
// of the browser session (utils/viewer-audio.ts) — until the next refresh.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultViewer } from './ResultViewer';
import { getViewerAudioMuted, setViewerAudioMuted, type ViewerEntry } from './utils';

// React 18 requires this flag for deterministic synchronous act() rendering.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    // Each test receives a fresh DOM tree so media properties cannot leak.
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // Reset the session mute memory so tests cannot leak it into each other
    // (the flag is module-level and survives renders by design).
    setViewerAudioMuted(true);
});

afterEach(() => {
    // Unmount before removing the host to release React's event handlers.
    act(() => root.unmount());
    container.remove();
    // Restore the default for any test file sharing this module instance.
    setViewerAudioMuted(true);
});

const videoEntry: ViewerEntry = {
    type: 'video',
    mimeType: 'video/mp4',
    size: 1,
    nodeId: 'node-video',
    generationId: 'generation-video',
    resultIndex: 0
};

// Render the smallest valid viewer state showing the given video entry.
function renderViewer(entry: ViewerEntry) {
    act(() =>
        root.render(
            <ResultViewer
                isMobile={false}
                entriesCount={1}
                current={entry}
                currentIndex={0}
                mediaUrl="/result/video.mp4"
                onClose={() => undefined}
                onNavigate={() => undefined}
            />
        )
    );
}

// Simulate the native mute toggle: native controls mutate the element's
// muted property directly, then the browser fires volumechange.
function toggleNativeMute(video: HTMLVideoElement, muted: boolean) {
    act(() => {
        video.muted = muted;
        // volumechange bubbles to React's root listener (onVolumeChange).
        video.dispatchEvent(new Event('volumechange', { bubbles: true }));
    });
}

describe('ResultViewer video preview', () => {
    it('renders video previews muted by default', () => {
        renderViewer(videoEntry);

        const video = container.querySelector('video');

        // The media element property is the playback engine's effective mute
        // state; React applies the boolean prop directly to that property.
        expect(video).not.toBeNull();
        expect(video?.muted).toBe(true);
        expect(video?.loop).toBe(true);
    });

    it('starts the next remounted video unmuted after the user unmutes once', () => {
        renderViewer(videoEntry);
        const first = container.querySelector('video');
        expect(first).not.toBeNull();

        // User unmutes via the native controls on the first video.
        toggleNativeMute(first as HTMLVideoElement, false);
        expect(getViewerAudioMuted()).toBe(false);

        // Navigating remounts the video (key = generationId:resultIndex) —
        // the fresh mount must start with the remembered unmuted state.
        renderViewer({ ...videoEntry, resultIndex: 1 });
        const second = container.querySelector('video');
        expect(second).not.toBeNull();
        expect(second?.muted).toBe(false);
    });

    it('starts the next remounted video muted after the user re-mutes', () => {
        renderViewer(videoEntry);
        const first = container.querySelector('video');
        expect(first).not.toBeNull();

        // Unmute, then re-mute via the native controls on the same video.
        toggleNativeMute(first as HTMLVideoElement, false);
        toggleNativeMute(first as HTMLVideoElement, true);
        expect(getViewerAudioMuted()).toBe(true);

        // The next remounted video returns to the muted default.
        renderViewer({ ...videoEntry, resultIndex: 1 });
        const second = container.querySelector('video');
        expect(second).not.toBeNull();
        expect(second?.muted).toBe(true);
    });
});
