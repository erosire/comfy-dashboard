// usePods preference preparation tests.
//
// The hook is exercised through its public pod-generation handler so the test
// verifies that the UI prepares the generation snapshot before either API call
// receives it, without involving a real pod or server.

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationEntry } from '../../../../api';
import type { UINode } from '../../../../nodes/node-type';
import { usePods } from './usePods';
import type { PodEntry } from './types';

// Mock only the network-facing functions used by the hook. The preference
// resolver itself remains real through the hook's workflow-prompt import.
const api = vi.hoisted(() => ({
    cloud: vi.fn(),
    cloudPrompt: vi.fn(),
    fetchPreferenceVariables: vi.fn()
}));

vi.mock('../../../../api', () => api);

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    api.fetchPreferenceVariables.mockResolvedValue({ name: { current: 'Ada' } });
    api.cloudPrompt.mockResolvedValue(new Response('{}', { status: 202 }));
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
});

const pod: PodEntry = {
    id: 'pod-1',
    podNumber: 1,
    name: 'A',
    pod_url: 'https://pod.example',
    status: 'ready',
    failCount: 0,
    activeGenerationIds: [],
    run: { status: 'idle' }
};

const nodes = [{ mode: 0 } as UINode];

const rawSnapshot: Record<string, unknown> = {
    '1': {
        class_type: 'TextBox',
        inputs: { prompt: 'Portrait of {{name}}', missing: '{{notConfigured}}' }
    }
};

describe('usePods preference preparation', () => {
    it('stores and submits the UI-prepared snapshot without a preference list', async () => {
        const generation: GenerationEntry = {
            id: 'generation-1',
            status: 'pending',
            createdDate: '2026-08-03T00:00:00.000Z',
            completedDate: null,
            generatedTime: null,
            error: null,
            prompt: {
                '1': {
                    class_type: 'TextBox',
                    inputs: { prompt: 'Portrait of Ada', missing: '' }
                }
            },
            result: []
        };
        const generateWorkflow = vi.fn().mockResolvedValue(generation);

        const Harness: React.FC = () => {
            const { handlePodGenerate } = usePods({
                baseUrl: 'http://host:5000/v1/comfy',
                nodes,
                editingWorkflowId: 'workflow-1',
                workflowName: null,
                generations: [],
                getCurrentRaw: () => rawSnapshot,
                generateWorkflow
            });
            const started = React.useRef(false);

            React.useEffect(() => {
                if (started.current) return;
                started.current = true;
                void handlePodGenerate(pod);
            }, [handlePodGenerate]);
            return null;
        };

        await act(async () => {
            root.render(<Harness />);
            // Flush the effect and each deterministic promise boundary in the
            // preference fetch → generation snapshot → pod submission chain.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        const preparedSnapshot = {
            '1': {
                class_type: 'TextBox',
                inputs: { prompt: 'Portrait of Ada', missing: '' }
            }
        };
        expect(api.fetchPreferenceVariables.mock.calls).toEqual([
            ['http://host:5000/v1/comfy']
        ]);
        expect(generateWorkflow.mock.calls).toEqual([
            ['workflow-1', preparedSnapshot, undefined]
        ]);
        expect(api.cloudPrompt.mock.calls).toEqual([[
            'http://host:5000/v1/comfy',
            {
                pod_url: 'https://pod.example',
                prompt: preparedSnapshot,
                workflow_id: 'workflow-1',
                generation_id: 'generation-1',
                extra_data: {
                    workflow_id: 'workflow-1',
                    generation_id: 'generation-1'
                }
            }
        ]]);
    });
});
