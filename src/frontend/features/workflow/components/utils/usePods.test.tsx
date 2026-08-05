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
import { POD_LIST_POLL_MS } from './constants';
import type { PodEntry } from './types';

// Mock only the network-facing functions used by the hook. The preference
// resolver itself remains real through the hook's workflow-prompt import.
const api = vi.hoisted(() => ({
    cloudCreate: vi.fn(),
    cloudListPods: vi.fn(),
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
    // The pod-list poll reports no server-side pods unless a test says so.
    api.cloudListPods.mockResolvedValue({ pods: [] });
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

// Shared harness for spawn scenarios: triggers a local '4090' spawn on
// mount while the pod-list poll is also running.
const spawnHarness = (seen: { current: PodEntry[] }): React.FC => () => {
    const { pods, handleGenerate } = usePods({
        baseUrl: 'http://host:5000/v1/comfy',
        nodes,
        editingWorkflowId: 'workflow-1',
        workflowName: null,
        generations: [],
        getCurrentRaw: () => rawSnapshot,
        generateWorkflow: vi.fn().mockResolvedValue({
            id: 'generation-1',
            status: 'pending',
            createdDate: '2026-08-03T00:00:00.000Z',
            completedDate: null,
            generatedTime: null,
            error: null,
            prompt: rawSnapshot,
            result: []
        } satisfies GenerationEntry)
    });
    seen.current = pods;
    const started = React.useRef(false);
    React.useEffect(() => {
        if (started.current) return;
        started.current = true;
        void handleGenerate('4090');
    }, [handleGenerate]);
    return null;
};

describe('usePods server pod-list polling', () => {
    it('adds server-reported pods as ready pod buttons automatically', async () => {
        // The server holds a pod the UI never spawned (another client, or a
        // page refresh) — the poll must surface it as a ready button. A
        // listed pod counts as alive; a dead pod simply drops OUT of the
        // server's list (its websocket is never reconnected).
        api.cloudListPods.mockResolvedValue({
            pods: [{
                pod_url: 'https://server-pod.example/',
                gpu: '4090',
                client_id: 'abc123def4567890fedcba0987654321',
                active: true,
                prompts: 0,
                connectedAt: '2026-08-05T10:15:30.000Z'
            }]
        });

        let seen: PodEntry[] = [];
        const Harness: React.FC = () => {
            const { pods } = usePods({
                baseUrl: 'http://host:5000/v1/comfy',
                nodes,
                editingWorkflowId: 'workflow-1',
                workflowName: null,
                generations: [],
                getCurrentRaw: () => rawSnapshot,
                generateWorkflow: vi.fn()
            });
            seen = pods;
            return null;
        };

        await act(async () => {
            root.render(<Harness />);
            // Flush the list fetch and the resulting state update.
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(api.cloudListPods.mock.calls).toContainEqual(['http://host:5000/v1/comfy']);
        // The server's normalized URL (URL.toString() with trailing slash)
        // is stored verbatim — prompt submission normalizes it server-side.
        expect(seen.map((p) => ({
            pod_url: p.pod_url,
            status: p.status,
            gpu: p.gpu,
            name: p.name,
            podNumber: p.podNumber,
            activeGenerationIds: p.activeGenerationIds,
            run: p.run
        }))).toEqual([{
            pod_url: 'https://server-pod.example/',
            status: 'ready',
            gpu: '4090',
            name: 'A',
            podNumber: 1,
            activeGenerationIds: [],
            run: { status: 'idle' }
        }]);
    });

    it('does not duplicate when the poll adds the normalized URL before the slow spawn resolves', async () => {
        // Poll answers INSTANTLY with the normalized URL; the spawn resolves
        // later with the verbatim Location — the merge must keep ONE button.
        api.cloudListPods.mockResolvedValue({
            pods: [{
                pod_url: 'https://pod.example/',
                gpu: '4090',
                client_id: 'abc123def4567890fedcba0987654321',
                active: true,
                prompts: 0,
                connectedAt: '2026-08-05T10:15:30.000Z'
            }]
        });
        api.cloudCreate.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return { pod_url: 'https://pod.example', gpu: '4090', spawner: 'lancer' };
        });

        const seen = { current: [] as PodEntry[] };
        const Harness = spawnHarness(seen);
        await act(async () => {
            root.render(<Harness />);
        });
        // The spawn's 10ms timer and the merge walk several promise/timer
        // turns — flush them in a separate act so the updates settle.
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(seen.current).toHaveLength(1);
        // The placeholder's verbatim pod_url survives the merge.
        expect(seen.current[0]).toMatchObject({ pod_url: 'https://pod.example', status: 'ready', gpu: '4090' });
    });

    it('does not duplicate when the spawn resolves before the slow poll answers', async () => {
        // Spawn answers INSTANTLY (verbatim Location); the delayed poll then
        // reports the normalized URL — dedupe must add nothing.
        api.cloudCreate.mockResolvedValue({ pod_url: 'https://pod.example', gpu: '4090', spawner: 'lancer' });
        api.cloudListPods.mockImplementation(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return {
                pods: [{
                    pod_url: 'https://pod.example/',
                    gpu: '4090',
                    client_id: 'abc123def4567890fedcba0987654321',
                    active: true,
                    prompts: 1,
                    connectedAt: '2026-08-05T10:15:30.000Z'
                }]
            };
        });

        const seen = { current: [] as PodEntry[] };
        const Harness = spawnHarness(seen);
        await act(async () => {
            root.render(<Harness />);
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50));
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(seen.current).toHaveLength(1);
        expect(seen.current[0]).toMatchObject({ pod_url: 'https://pod.example', status: 'ready', gpu: '4090' });
    });
});

describe('usePods server pod-list reconciliation', () => {
    // Shared observer harness: just mounts the hook and mirrors `pods`.
    const mountWithSeen = (seen: { current: PodEntry[] }) => {
        const Harness: React.FC = () => {
            const { pods } = usePods({
                baseUrl: 'http://host:5000/v1/comfy',
                nodes,
                editingWorkflowId: 'workflow-1',
                workflowName: null,
                generations: [],
                getCurrentRaw: () => rawSnapshot,
                generateWorkflow: vi.fn()
            });
            seen.current = pods;
            return null;
        };
        return Harness;
    };

    it('removes pod buttons the server no longer lists — disappearance is the definitive dead-socket verdict', async () => {
        vi.useFakeTimers();
        try {
            // First poll: the server holds TWO pods. From the next poll on:
            // EMPTY — both sockets died server-side (pods are designed to
            // terminate when idle and never reconnect).
            api.cloudListPods
                .mockResolvedValueOnce({
                    pods: [
                        {
                            pod_url: 'https://pod-a.example/',
                            gpu: '4090',
                            client_id: 'aaaaaaaabbbbccccddddeeeeffff0001',
                            active: true,
                            prompts: 0,
                            connectedAt: '2026-08-05T10:15:30.000Z'
                        },
                        {
                            pod_url: 'https://pod-b.example/',
                            gpu: 'B300',
                            client_id: 'aaaaaaaabbbbccccddddeeeeffff0002',
                            active: true,
                            prompts: 1,
                            connectedAt: '2026-08-05T10:16:30.000Z'
                        }
                    ]
                })
                .mockResolvedValue({ pods: [] });

            const seen = { current: [] as PodEntry[] };
            const Harness = mountWithSeen(seen);
            await act(async () => {
                root.render(<Harness />);
                await Promise.resolve();
                await Promise.resolve();
                await Promise.resolve();
            });

            // Both listed pods got buttons.
            expect(seen.current.map((p) => [p.pod_url, p.status])).toEqual([
                ['https://pod-a.example/', 'ready'],
                ['https://pod-b.example/', 'ready']
            ]);
            // NO per-pod probing happened — the list is the only liveness call.
            expect(api.cloudCreate.mock.calls).toEqual([]);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(POD_LIST_POLL_MS);
            });

            // Both vanished from the server list → both buttons removed,
            // without a single per-pod status request.
            expect(seen.current).toEqual([]);
            expect(api.cloudCreate.mock.calls).toEqual([]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps create-in-flight placeholders — an empty list cannot judge a pod the server was never asked for', async () => {
        vi.useFakeTimers();
        try {
            // The create call NEVER resolves during the test, so pod_url
            // stays '' (spawning) across the poll tick.
            api.cloudCreate.mockImplementation(() => new Promise(() => undefined));
            api.cloudListPods.mockResolvedValue({ pods: [] });

            const seen = { current: [] as PodEntry[] };
            const Harness = spawnHarness(seen);
            await act(async () => {
                root.render(<Harness />);
                await Promise.resolve();
                await Promise.resolve();
            });
            expect(seen.current.map((p) => [p.pod_url, p.status])).toEqual([['', 'spawning']]);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(POD_LIST_POLL_MS);
            });

            // The empty poll must NOT remove the spawning placeholder.
            expect(seen.current.map((p) => [p.pod_url, p.status])).toEqual([['', 'spawning']]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('never reconciles on a failed list fetch — an unreachable server is not an empty registry', async () => {
        vi.useFakeTimers();
        try {
            api.cloudListPods
                .mockResolvedValueOnce({
                    pods: [{
                        pod_url: 'https://pod-a.example/',
                        gpu: '4090',
                        client_id: 'aaaaaaaabbbbccccddddeeeeffff0001',
                        active: true,
                        prompts: 0,
                        connectedAt: '2026-08-05T10:15:30.000Z'
                    }]
                })
                // Every later poll fails (server down) — buttons must stay.
                .mockRejectedValue(new Error('server unreachable'));

            const seen = { current: [] as PodEntry[] };
            const Harness = mountWithSeen(seen);
            await act(async () => {
                root.render(<Harness />);
                await Promise.resolve();
                await Promise.resolve();
                await Promise.resolve();
            });
            expect(seen.current.map((p) => p.pod_url)).toEqual(['https://pod-a.example/']);

            await act(async () => {
                await vi.advanceTimersByTimeAsync(POD_LIST_POLL_MS * 2);
            });

            // Two failed polls later the pod STILL has its button: removals
            // require a definitive server answer, never a guess.
            expect(api.cloudListPods.mock.calls.length).toBe(3);
            expect(seen.current.map((p) => p.pod_url)).toEqual(['https://pod-a.example/']);
        } finally {
            vi.useRealTimers();
        }
    });
});
