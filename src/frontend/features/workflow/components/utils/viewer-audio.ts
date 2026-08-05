// Session memory for the result viewer's video mute state.
//
// Every generated video preview starts muted so opening a result never
// unexpectedly plays audio (see ResultViewer.tsx). When the user unmutes
// — or re-mutes — through the video element's native controls, the choice
// is remembered for the rest of the browser session: the <video> remounts
// per entry (keyed by generationId:resultIndex) and each fresh mount reads
// this module-level flag, so navigating to the next video keeps the
// remembered state.
//
// Deliberately NOT localStorage/sessionStorage: module memory dies with
// the page, so a browser refresh resets previews to muted — the requested
// lifetime is "remember until refresh".

// True while freshly mounted video previews must start muted (the default).
let viewerAudioMuted = true;

/** Read by ResultViewer on every video (re)mount. */
export function getViewerAudioMuted(): boolean {
    return viewerAudioMuted;
}

/**
 * Persist the user's mute choice. Called from the <video> element's
 * volumechange event — the native mute/unmute toggle and any programmatic
 * mute both funnel through it, so this always reflects the user's intent.
 */
export function setViewerAudioMuted(muted: boolean): void {
    viewerAudioMuted = muted;
}
