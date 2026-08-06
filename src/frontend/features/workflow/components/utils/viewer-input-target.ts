// Session memory for the result gallery's Input-workflow dropdown.
//
// ResultViewer is mounted only while a gallery item is open, so keeping the
// selected target solely in the dashboard's transient viewer-session state
// would reset it whenever the user closes one gallery and opens another. This
// module-level value intentionally survives those mounts for the current page
// session, while a full browser refresh naturally restores the Default choice.

// Null represents the explicit "Default" option, which reruns the viewed
// generation's own stored prompt instead of feeding the image into a workflow.
let viewerInputTargetId: string | null = null;

// Read the selected target when WorkflowDashboard initializes or remounts.
export function getViewerInputTargetId(): string | null {
    return viewerInputTargetId;
}

// Remember every user selection so later gallery sessions start on the same
// target. The null value is also persisted in memory so choosing Default is a
// deliberate choice rather than accidentally retaining an older workflow.
export function setViewerInputTargetId(targetId: string | null): void {
    viewerInputTargetId = targetId;
}

// Reset only the in-memory session value; this is exported for deterministic
// tests and does not represent a user-facing control.
export function clearViewerInputTargetMemory(): void {
    viewerInputTargetId = null;
}
