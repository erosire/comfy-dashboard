// Generation log endpoint
//
// GET /v1/comfy/workflows/:id/generate/:generate_id/log
//
// Answers the timestamped .log file the cloud prompt endpoint writes next
// to a generation's json while it consumes the pod's NDJSON stream
// server-side — the chronological trail of status changes and per-event
// summaries (see appendGenerationLog in generation-store.ts). The
// dashboard's OUTPUT tab opens this from a failed/error generation (click
// the red row/thumbnail) so a broken run can be READ and COPIED OUT for
// debugging without shell access to the server.
//
// The .log file only exists for runs processed through
// POST /v1/comfy/cloud/prompt. Generations written by other paths (or old
// enough to predate the .log trail) fall back to a SYNTHESIZED log built
// from the generation json itself (creation line, final status, timing,
// error message), so the response always carries something meaningful.
//
// Oversized logs are TAIL-TRUNCATED with a notice prepended — the recent
// lines are the ones that carry the terminal error, and a pathological run
// must not push megabytes into a debugging dialog.

import fs from 'node:fs/promises';
import { asHandlerMethod } from '@underload/service';
import { generationLogPath, readGenerationFile, type GenerationEntry } from './generation-store';

/**
 * Cap on the log payload handed to the client — older bytes beyond this
 * are dropped (with a notice) so the response stays dialog-sized.
 */
export const LOG_RESPONSE_MAX_BYTES = 256 * 1024;

/**
 * Build a minimal chronological trail for a generation that has no .log
 * file (pre-log generations, or entries written outside the cloud prompt
 * endpoint): one line per known fact, in the .log file's own timestamped
 * format, so it reads the same as a real trail.
 */
function synthesizeLog(entry: GenerationEntry): string {
    const lines: string[] = [
        '(no .log file recorded for this generation — trail synthesized from the generation json)',
        ''
    ];
    if (entry.createdDate) {
        lines.push(`[${entry.createdDate}] Generation created (status: pending)`);
    }
    if (entry.completedDate) {
        lines.push(
            `[${entry.completedDate}] Generation ${entry.status.toUpperCase()}` +
                (entry.generatedTime ? ` in ${entry.generatedTime}` : '')
        );
    } else {
        lines.push(`[${new Date().toISOString()}] Current status: ${entry.status} (not finished)`);
    }
    if (entry.error) {
        lines.push(`Error: ${entry.error}`);
    } else if (entry.status === 'completed') {
        lines.push(`${entry.result.length} result(s)`);
    }
    return lines.join('\n');
}

/** GET — Serve a generation's .log event trail as { log }. */
export const workflowGenerateLogGet = asHandlerMethod(async (_context, parameters, variables) => {
    const projectRoot: string = variables.root;
    const workflowId = parameters.path.id;
    const generateId = parameters.path.generate_id;

    if (!workflowId) {
        return { status: 400, response: { error: 'id is required' } };
    }
    if (!generateId) {
        return { status: 400, response: { error: 'generate_id is required' } };
    }

    const entry = await readGenerationFile(projectRoot, workflowId, generateId);
    if (!entry) {
        return { status: 404, response: { error: `Generation '${generateId}' not found` } };
    }

    // Single async read (no existsSync+readFileSync pair): a missing/unreadable
    // .log simply means there is no trail on disk → synthesize from the json.
    const logPath = generationLogPath(projectRoot, workflowId, generateId);
    let raw: Buffer;
    try {
        raw = await fs.readFile(logPath);
    } catch {
        return { status: 200, response: { log: synthesizeLog(entry) } };
    }
    if (raw.length <= LOG_RESPONSE_MAX_BYTES) {
        return { status: 200, response: { log: raw.toString('utf-8') } };
    }

    // Tail-truncate oversized logs: the recent lines carry the terminal
    // error; the dropped head is noted so the gap is explicit. The kept
    // slice starts on a whole line (skip to the first newline).
    const kept = raw.subarray(raw.length - LOG_RESPONSE_MAX_BYTES);
    const firstNewline = kept.indexOf(0x0a);
    const tail = (firstNewline >= 0 ? kept.subarray(firstNewline + 1) : kept).toString('utf-8');
    return {
        status: 200,
        response: {
            log: `(log truncated — showing the last ${LOG_RESPONSE_MAX_BYTES} of ${raw.length} bytes)\n\n${tail}`
        }
    };
});
