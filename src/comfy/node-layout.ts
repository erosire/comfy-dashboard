// =============================================================================
// ComfyUI Node Layout — Widget Label Registry (Thin Wrapper)
// =============================================================================
//
// This file re-exports everything from the node-registry/ folder.
// The actual node definitions live in individual files under node-registry/.
//
// Quick usage:
//
//   import { comfyNodeRegistry, getWidgetLabel } from './node-layout';
//
//   // Direct lookup by node type
//   const layout = comfyNodeRegistry["KSampler"];
//   layout.widgets.forEach((w, i) => console.log(i, w.label));
//   // 0 "Seed"
//   // 1 "Control After Generate"
//   // 2 "Steps"
//   // ...
//
//   // Or use the helper
//   const label = getWidgetLabel('KSampler', 0); // "Seed"
//
// For the most up-to-date definitions, always query the running ComfyUI
// backend via GET /object_info and call mergeObjectInfo() to enrich the
// static registry at runtime.
//
// Sources:
//   - ComfyUI backend: comfy_extras/nodes_flux.py (EmptyFlux2LatentImage)
//   - ComfyUI backend: nodes.py (KSampler, EmptyLatentImage, etc.)
//   - ComfyUI backend: comfy/samplers.py (SAMPLERS, SCHEDULERS lists)
//   - ComfyUI frontend: widgetStore.ts, litegraphService.ts
//   - GET /object_info endpoint
// =============================================================================

// ── Re-export all from node-registry ─────────────────────────────────────────
export {
    // Types
    type ComfyWidgetType,
    type NumberDisplayMode,
    type WidgetDef,
    type NodeWidgetLayout,

    // Enum constants
    SAMPLER_NAMES,
    SCHEDULER_NAMES,
    UPSCALE_METHODS,
    CROP_MODES,

    // Primary registry
    comfyNodeRegistry,

    // Helpers
    getWidgetLabel,
    getRegisteredNodeTypes,
    isNodeRegistered,
} from './node-registry';

// ── mergeObjectInfo ──────────────────────────────────────────────────────────

import { comfyNodeRegistry } from './node-registry';
import type { NodeWidgetLayout, WidgetDef, ComfyWidgetType } from './node-registry';

/**
 * Merge runtime node definitions from /object_info into the registry.
 * Enriches the static registry with live data from the running backend.
 *
 * After calling this, `comfyNodeRegistry[nodeType]` will contain the
 * runtime definition (overwriting or adding to the static one).
 *
 * Usage:
 *   const info = await fetch('/object_info').then(r => r.json());
 *   mergeObjectInfo(info);
 */
export function mergeObjectInfo(
    objectInfo: Record<string, {
        input?: {
            required?: Record<string, [string, Record<string, unknown>?]>;
            optional?: Record<string, [string, Record<string, unknown>?]>;
        };
        output?: Array<{ name: string; type: string; is_list?: boolean }>;
        name?: string;
        display_name?: string;
        category?: string;
        output_node?: boolean;
    }>,
): void {
    for (const [nodeType, def] of Object.entries(objectInfo)) {
        if (!def.input) continue;

        const required = def.input.required ?? {};
        const optional = def.input.optional ?? {};
        const allInputs = { ...required, ...optional };

        const widgets: WidgetDef[] = [];
        for (const [name, spec] of Object.entries(allInputs)) {
            const [type, opts] = Array.isArray(spec) ? spec : [spec as unknown as string, undefined];
            if (!type || type === '*') continue;

            const isConnectionType = [
                'MODEL', 'CLIP', 'VAE', 'CONDITIONING', 'LATENT',
                'IMAGE', 'MASK', 'CONTROL_NET', 'UPSCALE_MODEL',
            ].includes(type);
            if (isConnectionType && opts?.forceInput) continue;

            const widget: WidgetDef = {
                name,
                label: name
                    .replace(/_/g, ' ')
                    .replace(/\b\w/g, c => c.toUpperCase()),
                widgetType: type as ComfyWidgetType,
                ...(opts as Partial<WidgetDef> ?? {}),
            };

            widgets.push(widget);
        }

        const entry: NodeWidgetLayout = {
            nodeType,
            displayName: def.display_name ?? def.name ?? nodeType,
            category: def.category ?? 'unknown',
            widgets,
        };

        // Direct write into the keyed record
        comfyNodeRegistry[nodeType] = entry;
    }
}
