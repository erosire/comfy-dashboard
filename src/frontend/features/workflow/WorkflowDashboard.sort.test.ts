// =============================================================================
// Node execution-order tests
//
// Verifies that sortNodesDeep()/parseWorkflowJson() order nodes the way
// ComfyUI processes them — first to last (a node never executes before its
// inputs are ready), matching:
//   - LGraph.computeExecutionOrder() in @comfyorg/litegraph.js (Kahn / BFS)
//   - ExecutionList in comfy_execution/graph.py (dependency dissolve)
// =============================================================================

import { describe, it, expect } from 'vitest';
import { parseWorkflowJson, sortNodesDeep } from './components/utils';
import type { UINode } from '../../nodes/node-type';

// ── Helpers ──────────────────────────────────────────────────────────────────

let seq = 0;

/** Build a minimal UINode with the given id and upstream dependencies. */
function makeNode(id: string, deps: Array<{ sourceNodeId: string; sourceSlot?: number }> = []): UINode {
    return {
        id,
        classType: `Node${id}`,
        connections: deps.map((d, i) => ({
            name: `input_${i}`,
            type: 'MODEL',
            sourceNodeId: d.sourceNodeId,
            sourceSlot: d.sourceSlot ?? 0,
            linkId: seq++
        })),
        outputs: [],
        widgets: [],
        mode: 0,
        order: 0,
        properties: {},
        flags: {},
        position: [0, 0],
        size: [200, 100],
        _sourceFormat: 'workflow-v1'
    };
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('sortNodesDeep — execution order', () => {
    it('orders a standard txt2img pipeline like the ComfyUI backend does', () => {
        // Typical img workflow, stored out of order (as users often create
        // nodes in arbitrary order on the canvas).
        //
        //   4 CheckpointLoaderSimple ─┬─ model ─▶ 3 KSampler ─▶ 7 VAEDecode ─▶ 6 SaveImage
        //                             ├─ clip ───▶ 8 CLIPTextEncode (pos) ─┘   ▲
        //                             ├─ clip ───▶ 9 CLIPTextEncode (neg) ─┘   │
        //                             └─ vae ──────────────────────────────────┘
        //   5 EmptyLatentImage ───────── latent_image ────────────────────▶ 3
        //
        // ComfyUI backend ExecutionList (comfy_execution/graph.py) executes:
        //   4, 5, 9, 8, 3, 7, 6   (DFS-seeded ready-set, output-first heuristics)
        // LiteGraph computeExecutionOrder (Kahn BFS) yields the same sequence.
        const nodes: UINode[] = [
            makeNode('7', [
                { sourceNodeId: '3', sourceSlot: 0 },
                { sourceNodeId: '4', sourceSlot: 2 }
            ]),
            makeNode('4', []),
            makeNode('3', [
                { sourceNodeId: '4', sourceSlot: 0 },
                { sourceNodeId: '8', sourceSlot: 0 },
                { sourceNodeId: '9', sourceSlot: 0 },
                { sourceNodeId: '5', sourceSlot: 0 }
            ]),
            makeNode('5', []),
            makeNode('9', [{ sourceNodeId: '4', sourceSlot: 1 }]),
            makeNode('8', [{ sourceNodeId: '4', sourceSlot: 1 }]),
            makeNode('6', [{ sourceNodeId: '7', sourceSlot: 0 }])
        ];

        const sorted = sortNodesDeep(nodes);
        expect(sorted.map((n) => n.id)).toEqual(['4', '5', '9', '8', '3', '7', '6']);
        // order fields rewritten to execution indices
        expect(sorted.map((n) => n.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });

    it('fixes chained middle nodes that the old bucket sort mis-ordered', () => {
        // Chain A → B → C → D stored in scrambled array order.
        // The old sources/middle/sinks bucket sort would produce A, C, B, D
        // (C before its dependency B). The topological order is A, B, C, D.
        const nodes: UINode[] = [
            makeNode('C', [{ sourceNodeId: 'B' }]),
            makeNode('D', [{ sourceNodeId: 'C' }]),
            makeNode('B', [{ sourceNodeId: 'A' }]),
            makeNode('A', [{ sourceNodeId: 'SRC', sourceSlot: 0 }]) // waiting on external — still a source here? no:
        ];
        // Remove bogus external ref (out-of-set refs are ignored) and wire A as a real source:
        nodes[3].connections = [];

        const sorted = sortNodesDeep(nodes);
        expect(sorted.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D']);
    });

    it('discards completely unlinked nodes (ComfyUI never executes them)', () => {
        const nodes: UINode[] = [
            makeNode('1', []),                     // source  (feeds 2)
            makeNode('99', []),                    // unlinked — should be dropped
            makeNode('2', [{ sourceNodeId: '1' }]) // sink
        ];
        // give node 1 an outgoing link implicitly via node 2's connection
        const sorted = sortNodesDeep(nodes);
        expect(sorted.map((n) => n.id)).toEqual(['1', '2']);
    });

    it('places dependency cycles last instead of hanging', () => {
        // X → Y → X forms a cycle; Z feeds nothing but is fed by nothing.
        // Valid ComfyUI workflows never contain cycles (backend raises
        // DependencyCycleError), but the sorter must stay total + terminate.
        const nodes: UINode[] = [
            makeNode('X', [{ sourceNodeId: 'Y' }]),
            makeNode('Y', [{ sourceNodeId: 'X' }]),
            makeNode('S', []),
            makeNode('T', [{ sourceNodeId: 'S' }])
        ];
        const sorted = sortNodesDeep(nodes);
        expect(sorted).toHaveLength(4);
        // S and T execute first (S before T); cycle nodes come last, in array order.
        expect(sorted.map((n) => n.id)).toEqual(['S', 'T', 'X', 'Y']);
    });

    it('places a subgraph wrapper after the nodes that feed it', () => {
        // v1 workflow: node 2 is a subgraph (UUID type), fed by node 1
        // (CheckpointLoaderSimple → MODEL) and feeding node 3 (PreviewImage).
        // Stored with the wrapper FIRST in the array — the old bucket sort
        // displayed the wrapper before its feeder; the topological sort must
        // produce 1, 2, 3.
        const subgraphId = '11111111-2222-3333-4444-555555555555';
        const raw = {
            version: 1,
            nodes: [
                {
                    id: 2,
                    type: subgraphId,
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 1,
                    mode: 0,
                    properties: {},
                    inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
                    outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [2], slot_index: 0 }]
                },
                {
                    id: 1,
                    type: 'CheckpointLoaderSimple',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 0,
                    mode: 0,
                    properties: {},
                    outputs: [{ name: 'MODEL', type: 'MODEL', links: [1], slot_index: 0 }]
                },
                {
                    id: 3,
                    type: 'PreviewImage',
                    pos: [0, 0],
                    size: [200, 100],
                    flags: {},
                    order: 2,
                    mode: 0,
                    properties: {},
                    inputs: [{ name: 'images', type: 'IMAGE', link: 2 }]
                }
            ],
            links: [
                { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: 'MODEL' },
                { id: 2, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0, type: 'IMAGE' }
            ],
            definitions: {
                subgraphs: [
                    {
                        id: subgraphId,
                        version: 1,
                        name: 'MySubgraph',
                        inputNode: { id: -10, bounding: [0, 0, 100, 50] },
                        outputNode: { id: -20, bounding: [0, 0, 100, 50] },
                        inputs: [{ id: 'p1', name: 'model', type: 'MODEL', linkIds: [101] }],
                        outputs: [{ id: 'o1', name: 'IMAGE', type: 'IMAGE', linkIds: [102] }],
                        nodes: [
                            {
                                id: 21,
                                type: 'VAEDecode',
                                pos: [0, 0],
                                size: [200, 100],
                                flags: {},
                                order: 0,
                                mode: 0,
                                properties: {},
                                inputs: [{ name: 'samples', type: 'LATENT', link: 101 }],
                                outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [102], slot_index: 0 }]
                            }
                        ],
                        links: [
                            { id: 101, origin_id: -10, origin_slot: 0, target_id: 21, target_slot: 0, type: 'LATENT' },
                            { id: 102, origin_id: 21, origin_slot: 0, target_id: -20, target_slot: 0, type: 'IMAGE' }
                        ]
                    }
                ]
            }
        };

        const parsed = parseWorkflowJson(raw);

        // The wrapper's connection must carry the REAL external source
        // (previously it was a broken "" / -1 placeholder).
        const wrapper = parsed.find((n) => n.id === '2')!;
        expect(wrapper.connections).toHaveLength(1);
        expect(wrapper.connections[0].sourceNodeId).toBe('1');
        expect(wrapper.connections[0].sourceSlot).toBe(0);

        const sorted = sortNodesDeep(parsed);
        expect(sorted.map((n) => n.id)).toEqual(['1', '2', '3']);
    });
});
