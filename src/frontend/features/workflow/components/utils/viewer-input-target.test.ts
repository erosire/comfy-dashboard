// Result gallery Input-workflow dropdown session-memory tests.
//
// The selected target must survive closing one gallery and opening another,
// but choosing Default must explicitly clear the remembered target. The
// module-level implementation is page-session memory, not persistent storage,
// so a browser refresh creates a fresh module value.

import { afterEach, describe, expect, it } from 'vitest';
import {
    clearViewerInputTargetMemory,
    getViewerInputTargetId,
    setViewerInputTargetId
} from './viewer-input-target';

afterEach(() => {
    // Isolate each deterministic memory scenario from the next test.
    clearViewerInputTargetMemory();
});

describe('viewer Input-workflow dropdown memory', () => {
    it('starts with Default selected when no gallery choice exists', () => {
        expect(getViewerInputTargetId()).toBe(null);
    });

    it('retains a selected workflow across later gallery sessions', () => {
        setViewerInputTargetId('workflow-target-123');

        // Reading through the same module after a viewer remount returns the
        // exact workflow id selected in the earlier gallery.
        expect(getViewerInputTargetId()).toBe('workflow-target-123');
    });

    it('remembers an explicit return to Default', () => {
        setViewerInputTargetId('workflow-target-123');
        setViewerInputTargetId(null);

        expect(getViewerInputTargetId()).toBe(null);
    });
});
