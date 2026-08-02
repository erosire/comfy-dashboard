// Persistent storage for the long-lived ComfyUI connection logs.
//
// Every ComfyUI prompt identifier gets its own JSON file at:
//   <root>/connect/<connect_id>/<prompt_id>.json
// The server records every websocket message it receives for a connection:
// messages carrying `data.prompt_id` land in that prompt's file; messages
// without one (status broadcasts, binary preview frames) are attributed to
// the connection's session log or the prompt currently in flight (see
// connect.ts). Keeping the files separate lets GET
// /v1/comfy/connect/:connect_id/:prompt_id address exactly one prompt's
// stream of events.

import fs from 'node:fs/promises';
import path from 'node:path';

// A prompt/connection identifier is used as a path segment, so only
// URL/file-safe values are accepted. ComfyUI prompt ids are UUIDs (with
// dashes) and connect ids are generated the same way.
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

// Writes for one file are serialized so simultaneous websocket messages cannot
// overwrite one another after both have read the same previous JSON document.
const writeQueues = new Map<string, Promise<void>>();

/** One timestamped raw websocket message stored in a prompt log file. */
export type ConnectLogEvent = {
    receivedAt: string;
    message: unknown;
};

/** The complete JSON document persisted for one ComfyUI prompt identifier. */
export type ConnectPromptLog = {
    connectId: string;
    promptId: string;
    podUrl: string;
    createdAt: string;
    updatedAt: string;
    events: ConnectLogEvent[];
};

/** Metadata required when a new prompt log file is first created. */
export type ConnectPromptLogMetadata = Pick<ConnectPromptLog, 'connectId' | 'promptId' | 'podUrl'>;

/** Return whether a caller-controlled id is safe to use as a file name. */
export function isSafeConnectPathSegment(value: unknown): value is string {
    return typeof value === 'string' && SAFE_PATH_SEGMENT.test(value);
}

/** Resolve the individual JSON file for a connect/prompt pair. */
export function connectPromptLogPath(root: string, connectId: string, promptId: string): string {
    if (!isSafeConnectPathSegment(connectId)) {
        throw new Error(`Invalid connect_id: ${connectId}`);
    }
    if (!isSafeConnectPathSegment(promptId)) {
        throw new Error(`Invalid prompt_id: ${promptId}`);
    }
    return path.join(root, 'connect', connectId, `${promptId}.json`);
}

/** Run a file operation after all earlier operations for that same file. */
function enqueueFileWrite(filePath: string, operation: () => Promise<void>): Promise<void> {
    const previous = writeQueues.get(filePath) ?? Promise.resolve();
    const next = previous
        // A failed write must not permanently block later websocket events.
        .catch(() => undefined)
        .then(operation);

    writeQueues.set(filePath, next);
    // Attach cleanup handlers without creating an unhandled rejecting promise
    // when the underlying disk operation fails and its caller catches it.
    void next.then(
        () => cleanupQueuedWrite(filePath, next),
        () => cleanupQueuedWrite(filePath, next)
    );
    return next;
}

/** Remove a settled queue only when no newer operation replaced it. */
function cleanupQueuedWrite(filePath: string, operation: Promise<void>): void {
    // Only remove the current operation; a later operation may already be
    // queued by the time this one settles.
    if (writeQueues.get(filePath) === operation) {
        writeQueues.delete(filePath);
    }
}

/** Read a previously persisted log, returning null for missing/invalid files. */
export async function readPromptLog(root: string, connectId: string, promptId: string): Promise<ConnectPromptLog | null> {
    const filePath = connectPromptLogPath(root, connectId, promptId);
    const pending = writeQueues.get(filePath);
    if (pending) {
        // Reads observe the latest completed append, while a failed append is
        // treated as best-effort because the prior JSON file may still exist.
        await pending.catch(() => undefined);
    }

    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<ConnectPromptLog>;
        if (!parsed || !Array.isArray(parsed.events)) return null;
        return parsed as ConnectPromptLog;
    } catch {
        return null;
    }
}

/** Ensure a prompt file exists before the first websocket event arrives. */
export async function ensurePromptLog(
    root: string,
    metadata: ConnectPromptLogMetadata,
    now: string = new Date().toISOString()
): Promise<void> {
    const filePath = connectPromptLogPath(root, metadata.connectId, metadata.promptId);
    await enqueueFileWrite(filePath, async () => {
        try {
            await fs.access(filePath);
            return;
        } catch {
            // The file is created below when this is the first observation.
        }

        const document: ConnectPromptLog = {
            ...metadata,
            createdAt: now,
            updatedAt: now,
            events: []
        };
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(document, null, 2), 'utf8');
    });
}

/** Append one websocket message to its prompt-specific JSON file. */
export async function appendPromptLogEvent(
    root: string,
    metadata: ConnectPromptLogMetadata,
    message: unknown,
    receivedAt: string = new Date().toISOString()
): Promise<void> {
    const filePath = connectPromptLogPath(root, metadata.connectId, metadata.promptId);
    await enqueueFileWrite(filePath, async () => {
        let document: ConnectPromptLog;
        try {
            document = JSON.parse(await fs.readFile(filePath, 'utf8')) as ConnectPromptLog;
            if (!Array.isArray(document.events)) throw new Error('Invalid connect log');
        } catch {
            // Recreate a missing/corrupt file instead of dropping the live log.
            document = {
                ...metadata,
                createdAt: receivedAt,
                updatedAt: receivedAt,
                events: []
            };
        }

        document.events.push({ receivedAt, message });
        document.updatedAt = receivedAt;
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, JSON.stringify(document, null, 2), 'utf8');
    });
}

/** Wait for currently queued writes; exported for deterministic unit tests. */
export async function flushPromptLogWrites(): Promise<void> {
    await Promise.all([...writeQueues.values()].map((pending) => pending.catch(() => undefined)));
}
