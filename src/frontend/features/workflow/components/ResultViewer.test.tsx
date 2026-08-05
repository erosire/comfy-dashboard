// ResultViewer media defaults — video previews autoplay silently so opening a
// generated result never unexpectedly plays audio; native controls can unmute.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ResultViewer } from './ResultViewer';
import type { ViewerEntry } from './utils';

// React 18 requires this flag for deterministic synchronous act() rendering.
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    // Each test receives a fresh DOM tree so media properties cannot leak.
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    // Unmount before removing the host to release React's event handlers.
    act(() => root.unmount());
    container.remove();
});

const videoEntry: ViewerEntry = {
    type: 'video',
    mimeType: 'video/mp4',
    size: 1,
    nodeId: 'node-video',
    generationId: 'generation-video',
    resultIndex: 0
};

describe('ResultViewer video preview', () => {
    it('renders video previews muted by default', () => {
        // Render the smallest valid viewer state containing a video result.
        act(() =>
            root.render(
                <ResultViewer
                    isMobile={false}
                    entriesCount={1}
                    current={videoEntry}
                    currentIndex={0}
                    mediaUrl="/result/video.mp4"
                    onClose={() => undefined}
                    onNavigate={() => undefined}
                />
            )
        );

        const video = container.querySelector('video');

        // The media element property is the playback engine's effective mute
        // state; React applies the boolean prop directly to that property.
        expect(video).not.toBeNull();
        expect(video?.muted).toBe(true);
        expect(video?.loop).toBe(true);
    });
});
