// Shared generation-file store.
//
// A generation json lives at:
//   <root>/temporary/database/comfy-workflows/<workflowId>/generation/<generateId>.json
//
// Used by the workflow generate endpoints (CRUD) and by the cloud prompt
// endpoint, which updates the same file server-side while it consumes a
// pod's NDJSON stream in the background. Keeping the types + IO in one
// place guarantees both write paths produce identical data.

import fs from 'node:fs';
import path from 'node:path';

export type GenerationResultItem = {
    type: 'image' | 'video';
    url: string;
    mimeType: string;
    size: number;
    nodeId: string;
};

export type StreamEvent = {
    type: string;
    data: Record<string, unknown>;
};

export type GenerationEntry = {
    id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    createdDate: string;
    completedDate: string | null;
    generatedTime: string | null;
    error: string | null;
    prompt: Record<string, unknown>;
    result: GenerationResultItem[];
    stream: StreamEvent[];
};

export type GenerationPatch = Partial<
    Pick<GenerationEntry, 'status' | 'result' | 'stream' | 'generatedTime' | 'completedDate' | 'error'>
>;

export function generationFilePath(root: string, workflowId: string, generateId: string): string {
    return path.join(
        root,
        'temporary/database/comfy-workflows',
        workflowId,
        'generation',
        `${generateId}.json`
    );
}

/** Read + normalize a generation file. Returns null if missing or corrupted. */
export function readGenerationFile(
    root: string,
    workflowId: string,
    generateId: string
): GenerationEntry | null {
    const filePath = generationFilePath(root, workflowId, generateId);
    if (!fs.existsSync(filePath)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return {
            id: data.id ?? generateId,
            status: data.status ?? 'pending',
            createdDate: data.createdDate ?? '',
            completedDate: data.completedDate ?? null,
            generatedTime: data.generatedTime ?? null,
            error: data.error ?? null,
            prompt: data.prompt ?? {},
            result: Array.isArray(data.result) ? data.result : [],
            stream: Array.isArray(data.stream) ? data.stream : []
        };
    } catch {
        return null;
    }
}

export function writeGenerationFile(
    root: string,
    workflowId: string,
    generateId: string,
    entry: GenerationEntry
): void {
    fs.writeFileSync(
        generationFilePath(root, workflowId, generateId),
        JSON.stringify(entry, null, 2),
        'utf-8'
    );
}

/**
 * Merge a partial patch into an existing generation file.
 * Only provided fields are overwritten. Returns the updated entry,
 * or null when the file is missing/unreadable.
 */
export function patchGenerationFile(
    root: string,
    workflowId: string,
    generateId: string,
    patch: GenerationPatch
): GenerationEntry | null {
    const existing = readGenerationFile(root, workflowId, generateId);
    if (!existing) return null;

    if (patch.status !== undefined) existing.status = patch.status;
    if (patch.completedDate !== undefined) existing.completedDate = patch.completedDate;
    if (patch.generatedTime !== undefined) existing.generatedTime = patch.generatedTime;
    if (patch.error !== undefined) existing.error = patch.error;
    if (patch.result !== undefined) existing.result = patch.result;
    if (patch.stream !== undefined) existing.stream = patch.stream;

    writeGenerationFile(root, workflowId, generateId, existing);
    return existing;
}
