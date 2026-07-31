// Execution-order sorting & ID renumbering for the UINode tree.
//
// Extracted verbatim from the original CloudTab.tsx.

import type { UIInputConnection, UINode } from '../../../../nodes/node-type';

/**
 * Sort nodes into ComfyUI execution order — the order ComfyUI processes the
 * graph, first to last (a node never executes before its inputs are ready).
 *
 * This mirrors how ComfyUI itself orders execution:
 *
 *   - Frontend: `LGraph.computeExecutionOrder()` (@comfyorg/litegraph.js,
 *     src/LGraph.ts) performs Kahn's algorithm (BFS): seed a FIFO queue with
 *     every node that has no incoming links (in graph order), then repeatedly
 *     emit the queue head and push each downstream node whose remaining links
 *     reach zero. The resulting index is written to each node's `order`
 *     field and serialized into the workflow JSON.
 *
 *   - Backend: `ExecutionList` (comfy_execution/graph.py) runs the same
 *     dependency dissolve at runtime: a node is "ready" once all upstream
 *     dependencies have executed, and execution walks the ready set —
 *     dependencies always execute before their dependents. Only nodes that
 *     are ancestors of an output node are scheduled at all.
 *
 * Algorithm (Kahn's / BFS over the link graph):
 *   1. Seed a FIFO queue with every node that has no incoming links,
 *      in workflow-array order (LiteGraph iterates the graph's node array).
 *   2. Emit the queue head, then decrement the remaining-link count of every
 *      node it feeds — visiting links in output-slot order, then link-id order
 *      (link ids increase in creation order), like LiteGraph. A downstream
 *      node whose count reaches zero is appended to the queue.
 *   3. Any leftovers (dependency cycles — invalid workflows that the ComfyUI
 *      backend rejects with DependencyCycleError) are appended last in
 *      original array order, exactly as LiteGraph does.
 *
 * Nodes with no links at all (neither incoming nor outgoing) are discarded:
 * ComfyUI never executes them, since they are not ancestors of an output node.
 *
 * EXCEPTION — `protectedNodeIds`: when sorting a subgraph's internal nodes,
 * nodes that feed the subgraph's -20 output sentinel LOOK unlinked (their
 * only links leave the internal node set, so neither incoming nor outgoing
 * is counted) but they are the roots of the internal graph — their data
 * exits the subgraph. Discarding them would empty loader-bank subgraphs
 * (e.g. a "Models" group whose loaders only feed subgraph outputs) and lose
 * subgraph outputs produced by such nodes. sortNodesDeep therefore passes
 * the ids of -20 feeders so they are kept (as seeds, since they have no
 * counted incoming links).
 *
 * Each returned node's `order` field is rewritten to its computed execution
 * index so downstream consumers see truthful ordering metadata.
 */
export function sortNodes(nodes: UINode[], protectedNodeIds?: ReadonlySet<string>): UINode[] {
    const nodeIds = new Set(nodes.map((n) => n.id));
    const nodeById = new Map(nodes.map((n): [string, UINode] => [n.id, n]));

    // Remaining incoming links per node, and outgoing links per source.
    // Counts are per-link (not per-source-node): a source feeding the same
    // target through two inputs blocks it twice, exactly like LiteGraph.
    const remainingLinks = new Map<string, number>();
    const outlinks = new Map<string, { targetId: string; sourceSlot: number; linkId: number }[]>();

    for (const n of nodes) {
        remainingLinks.set(n.id, 0);
        outlinks.set(n.id, []);
    }

    for (const n of nodes) {
        for (const conn of n.connections) {
            // Ignore links to nodes outside this set (e.g. subgraph internals
            // referencing external nodes — those data are already available).
            if (!nodeIds.has(conn.sourceNodeId)) continue;
            remainingLinks.set(n.id, remainingLinks.get(n.id)! + 1);
            outlinks.get(conn.sourceNodeId)!.push({
                targetId: n.id,
                sourceSlot: conn.sourceSlot,
                linkId: conn.linkId ?? 0
            });
        }
    }

    // Visit each node's outgoing links in LiteGraph's order:
    // output slot order, then link id within the slot.
    for (const links of outlinks.values()) {
        links.sort((a, b) => a.sourceSlot - b.sourceSlot || a.linkId - b.linkId);
    }

    // Seed the FIFO queue with zero-input nodes in the original array order.
    const queue: string[] = [];
    for (const n of nodes) {
        const incoming = remainingLinks.get(n.id)!;
        const outgoing = outlinks.get(n.id)!.length;
        // Unlinked — never executes. Protected nodes (subgraph internal
        // nodes feeding the -20 output sentinel) only LOOK unlinked: their
        // links leave the internal node set. They must be kept.
        if (incoming === 0 && outgoing === 0 && !protectedNodeIds?.has(n.id)) continue;
        if (incoming === 0) queue.push(n.id);
    }

    const result: UINode[] = [];
    const emitted = new Set<string>();
    let head = 0;
    while (head < queue.length) {
        const id = queue[head++];
        if (emitted.has(id)) continue;
        emitted.add(id);
        result.push({ ...nodeById.get(id)!, order: result.length });
        for (const link of outlinks.get(id)!) {
            if (emitted.has(link.targetId)) continue;
            const remaining = remainingLinks.get(link.targetId)! - 1;
            remainingLinks.set(link.targetId, remaining);
            if (remaining === 0) queue.push(link.targetId);
        }
    }

    // Leftovers (dependency cycles) go last in original array order, as LiteGraph does.
    for (const n of nodes) {
        if (!emitted.has(n.id) && remainingLinks.get(n.id)! > 0) {
            result.push({ ...n, order: result.length });
        }
    }

    return result;
}

/**
 * Sort a node tree into ComfyUI execution order, recursing into each
 * subgraph's internal nodes (which form their own dependency graphs).
 *
 * `protectedNodeIds` — node ids that must not be discarded even when they
 * have no counted incoming/outgoing links (see sortNodes). Computed per
 * subgraph from the wrapper's internal links: every internal node feeding
 * the -20 output sentinel is a graph root whose data exits the subgraph.
 */
export function sortNodesDeep(nodes: UINode[], protectedNodeIds?: ReadonlySet<string>): UINode[] {
    return sortNodes(nodes, protectedNodeIds).map((n) => {
        if (!n.subgraphNodes || n.subgraphNodes.length === 0) return n;
        return { ...n, subgraphNodes: sortNodesDeep(n.subgraphNodes, subgraphOutputRootIds(n)) };
    });
}

/**
 * Ids of a subgraph wrapper's internal nodes that feed the -20 output
 * sentinel (the subgraph's output ports). These nodes must survive the
 * execution-order sort even though they have no links within the internal
 * node set — otherwise subgraphs whose internals only produce outputs
 * (loader banks, primitive settings) would be emptied out, and the wrapper
 * could no longer be flattened into a valid API prompt.
 */
function subgraphOutputRootIds(wrapper: UINode): Set<string> {
    const ids = new Set<string>();
    for (const link of wrapper.subgraphLinks ?? []) {
        if (String(link.target_id) === '-20') {
            ids.add(String(link.origin_id));
        }
    }
    return ids;
}

/** Re-number node IDs sequentially from 1 and update all link references. */
export function renumberNodes(nodes: UINode[]): UINode[] {
    const idMap = new Map<string, string>();
    nodes.forEach((n, i) => idMap.set(n.id, String(i + 1)));

    return nodes.map((n) => {
        const connections: UIInputConnection[] = n.connections.map((conn) => {
            const newSrc = idMap.get(conn.sourceNodeId);
            return newSrc != null ? { ...conn, sourceNodeId: newSrc } : conn;
        });
        // Recursively renumber subgraph internal nodes with parent-prefixed IDs
        const subgraphNodes = n.subgraphNodes
            ? renumberSubgraphNodes(n.subgraphNodes, idMap.get(n.id)!, idMap)
            : undefined;
        return { ...n, id: idMap.get(n.id)!, connections, subgraphNodes };
    });
}

/**
 * Re-number subgraph internal node IDs with a parent-prefixed scheme.
 * Internal nodes get IDs like "3-1", "3-2", etc. (where 3 is the parent subgraph ID).
 * All cross-references between internal nodes are updated accordingly.
 * References to external nodes (via externalIdMap) are also updated.
 *
 * `externalIdMap` must include ALL IDs visible from this nesting level that are
 * NOT internal to this subgraph: parent-sibling nodes (from every enclosing
 * subgraph) AND top-level nodes. This is essential so that boundary links
 * rewritten from the -10 sentinel to a top-level node (e.g. "74") can still be
 * renumbered to the top-level prompt ID (e.g. "4") at any depth.
 */
export function renumberSubgraphNodes(
    internalNodes: UINode[],
    parentPrefix: string,
    externalIdMap: Map<string, string>
): UINode[] {
    const internalIdMap = new Map<string, string>();
    internalNodes.forEach((n, i) => internalIdMap.set(n.id, `${parentPrefix}-${i + 1}`));

    return internalNodes.map((n) => {
        const connections: UIInputConnection[] = n.connections.map((conn) => {
            // Check if source is another internal node first
            const newInternalSrc = internalIdMap.get(conn.sourceNodeId);
            if (newInternalSrc != null) {
                return { ...conn, sourceNodeId: newInternalSrc };
            }
            // Check if source is an external node (boundary link from subgraph input)
            const newExternalSrc = externalIdMap.get(conn.sourceNodeId);
            if (newExternalSrc != null) {
                return { ...conn, sourceNodeId: newExternalSrc };
            }
            // Unknown source — keep as-is
            return conn;
        });
        // Recursively renumber deeper subgraph nesting levels.
        // Pass a merged map so nested subgraphs can resolve both their parent's
        // internal siblings (internalIdMap) AND any out-of-subgraph references
        // the parent already knew about (externalIdMap) — including top-level IDs.
        const myNewId = internalIdMap.get(n.id)!;
        const combinedExternalMap = new Map<string, string>([...externalIdMap.entries(), ...internalIdMap.entries()]);
        const subgraphNodes =
            n.subgraphNodes && n.subgraphNodes.length > 0
                ? renumberSubgraphNodes(n.subgraphNodes, myNewId, combinedExternalMap)
                : undefined;
        return { ...n, id: myNewId, connections, subgraphNodes };
    });
}
