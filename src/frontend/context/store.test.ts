// Dashboard store workflow-ordering tests.
//
// Generation creation is acknowledged before the next workflow-list poll.
// These pure helper tests pin the immediate local ordering used during that
// gap, while the server-side workflow-generate test pins persisted ordering.

import { describe, expect, it } from 'vitest';
import type { WorkflowMeta } from '../api';
import { sortWorkflowsByModifiedDate, touchWorkflowInList } from './store';

function makeWorkflow(id: string, modifiedDate: string): WorkflowMeta {
    // Keep all required metadata fields present so the fixture follows the
    // same shape as GET /v1/comfy/workflows responses.
    return {
        id,
        name: id,
        nodeCount: 0,
        createdDate: '2026-08-01T00:00:00.000Z',
        modifiedDate
    };
}

describe('workflow list recency helpers', () => {
    it('sorts workflow metadata by modifiedDate descending without mutating input', () => {
        const original = [
            makeWorkflow('older', '2026-08-01T00:00:00.000Z'),
            makeWorkflow('newer', '2026-08-06T00:00:00.000Z'),
            makeWorkflow('middle', '2026-08-03T00:00:00.000Z')
        ];

        expect(sortWorkflowsByModifiedDate(original).map((workflow) => workflow.id)).toEqual([
            'newer',
            'middle',
            'older'
        ]);
        expect(original.map((workflow) => workflow.id)).toEqual(['older', 'newer', 'middle']);
    });

    it('touches the generated workflow and moves it to the first position', () => {
        const original = [
            makeWorkflow('older', '2026-08-01T00:00:00.000Z'),
            makeWorkflow('selected', '2026-08-02T00:00:00.000Z'),
            makeWorkflow('newest', '2026-08-05T00:00:00.000Z')
        ];

        const updated = touchWorkflowInList(original, 'selected', '2026-08-06T12:34:56.789Z');

        expect(updated.map((workflow) => workflow.id)).toEqual(['selected', 'newest', 'older']);
        expect(updated[0]).toEqual({
            ...original[1],
            modifiedDate: '2026-08-06T12:34:56.789Z'
        });
        expect(original[1].modifiedDate).toBe('2026-08-02T00:00:00.000Z');
    });

    it('keeps the generated workflow first when another timestamp is in the future', () => {
        const original = [
            makeWorkflow('selected', '2026-08-02T00:00:00.000Z'),
            makeWorkflow('future-dated', '2099-01-01T00:00:00.000Z')
        ];

        expect(touchWorkflowInList(original, 'selected', '2026-08-06T12:34:56.789Z').map((workflow) => workflow.id)).toEqual([
            'selected',
            'future-dated'
        ]);
    });

    it('keeps the list sorted when a generation references an unknown workflow', () => {
        const original = [
            makeWorkflow('older', '2026-08-01T00:00:00.000Z'),
            makeWorkflow('newer', '2026-08-05T00:00:00.000Z')
        ];

        expect(touchWorkflowInList(original, 'missing', '2026-08-06T12:34:56.789Z').map((workflow) => workflow.id)).toEqual([
            'newer',
            'older'
        ]);
    });
});
