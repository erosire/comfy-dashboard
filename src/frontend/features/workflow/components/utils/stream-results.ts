// Result capture from pod stream events.
//
// Three event shapes carry media payloads back from a ComfyUI pod:
//
//   - `imagepreview.update` → { image: 'data:image/png;base64,…', node_id }
//     (handled inline by the consumers; small preview frames)
//
//   - `server_client_data`  → { files: [{ filename, data, format }], prompt_id }
//     Emitted by the ComfyUI-CloudClient pack's FileCompressor via
//     PromptServer.send_sync when it "saves" its output back to the caller.
//     `data` is RAW base64 (no data: URI prefix) and `format` the lowercase
//     file extension ("mp4" | "webm" | "gif" | "png" | "jpeg" | "mp3" | "zip" | …).
//
//   - `server_client_data_chunk` → one piece of ONE file of the same socket
//     (see repository/ComfyUI-CloudClient/utils/streaming.py):
//       { transfer_id, filename, format, chunk_index, total_chunks, data, prompt_id }
//     The image/video save nodes used to emit the whole payload as a single
//     legacy `server_client_data` frame — megabytes of base64 per line on the
//     pod's websocket. They now slice the payload on a multiple-of-3 byte
//     boundary (so each chunk's base64 is independently decodable, no
//     carry-over between groups) and stream it as many small frames. Every
//     frame repeats the full assembly metadata, so concurrent transfers
//     (several generations sharing one pod websocket) can never mix — the
//     receiver keys everything by `transfer_id`.
//
// This module converts the legacy shape into generation-result items (the
// same structural type the generation store persists) AND reassembles the
// chunked shape back into the equivalent single "completed file" records, so
// the stream consumer — the server-side background processor in
// endpoints/cloud/cloud-prompt.ts — captures both shapes identically.

import { base64ByteSize } from './pod-utils';

/** Minimal event shape both consumers stream (matches StreamEvent). */
export type StreamEventLike = {
    type: string;
    data: Record<string, unknown>;
};

/** Structural mirror of the server store's GenerationResultItem. */
export type StreamResultItem = {
    type: 'image' | 'video' | 'audio';
    url: string;
    mimeType: string;
    size: number;
    nodeId: string;
};

/** One captured server_client_data file: its result item + original name. */
export type ExtractedStreamFile = {
    filename: string;
    result: StreamResultItem;
};

/**
 * Viewable file extensions → MIME types. Aligned with the CloudClient
 * pack's own js handler (js/server_client_data.js) and the result
 * endpoint's MIME_EXTENSIONS.
 */
const FILE_FORMAT_MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    mp3: 'audio/mpeg',
    wav: 'audio/wav'
};

/** Extension of a filename, lowercase, '' when there is none. */
function extensionOf(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * Convert ONE legacy file entry ({ filename, data, format }) into a
 * generation-result item, or null when the entry is non-viewable or
 * malformed. Shared by the legacy extractor and the chunk assembler's
 * completed-file callback so both shapes produce identical records.
 *
 * Non-viewable payloads (e.g. the FileCompressor's zip archive — a
 * download-flow file, not a dashboard result) are skipped.
 */
export function streamResultFromClientDataFile(
    file: Record<string, unknown>,
    eventIdNodeKey: Record<string, unknown> = {}
): StreamResultItem | null {
    const filename = typeof file.filename === 'string' ? file.filename : '';
    const rawData = typeof file.data === 'string' ? file.data : '';
    if (!rawData) return null;

    let mime: string;
    let payload: string;
    if (rawData.startsWith('data:')) {
        // Defensive: an emitter that already ships a full data: URI —
        // split it back into mime + payload (re-wrapped canonically below).
        const commaIdx = rawData.indexOf(',');
        if (commaIdx === -1) return null;
        const meta = rawData.substring(0, commaIdx);
        if (!/;base64/i.test(meta)) return null;
        mime = /^data:([^;,]*)/.exec(meta)?.[1] ?? '';
        payload = rawData.substring(commaIdx + 1);
    } else {
        // The CloudClient shape: raw base64 + a `format` extension hint
        // (fall back to the filename's extension when format is absent).
        const format =
            (typeof file.format === 'string' ? file.format.toLowerCase() : '') || extensionOf(filename);
        mime = FILE_FORMAT_MIME[format] ?? '';
        payload = rawData;
    }

    if (!mime) return null;

    // Only viewable/playable media becomes a generation result — the
    // OUTPUT tab renders results as <img>/<video>/<audio>; other
    // payloads are skipped.
    if (!/^image\//.test(mime) && !/^video\//.test(mime) && !/^audio\//.test(mime)) return null;

    return {
        type: mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image',
        url: `data:${mime};base64,${payload}`,
        mimeType: mime,
        size: base64ByteSize(payload),
        nodeId: (eventIdNodeKey?.node_id as string) ?? ''
    };
}

/**
 * Convert a legacy `server_client_data` stream event into generation result
 * items — one per file the event carries whose payload maps to a viewable
 * image/* or video/* MIME type. Returns [] for any other event type.
 */
export function extractServerClientDataResults(event: StreamEventLike): ExtractedStreamFile[] {
    if (event.type !== 'server_client_data') return [];
    const data = event.data;
    const files = data?.files;
    if (!Array.isArray(files)) return [];

    const out: ExtractedStreamFile[] = [];
    for (const entry of files) {
        if (!entry || typeof entry !== 'object') continue;
        const file = entry as Record<string, unknown>;
        const result = streamResultFromClientDataFile(file, data);
        // Filename normalizes exactly as streamResultFromClientDataFile did
        // inline — a non-string name degrades to '' without skipping the file.
        if (result) out.push({ filename: typeof file.filename === 'string' ? file.filename : '', result });
    }
    return out;
}

// ── Chunked transfers (`server_client_data_chunk`, streaming.py protocol) ──

/** The event name one chunk frame arrives under (streaming.py EVENT_NAME). */
export const CLIENT_DATA_CHUNK_EVENT = 'server_client_data_chunk';

/** How long an INCOMPLETE transfer may run without receiving a NEW frame
 * before the assembler sweeps it (activity-based staleness — a long video
 * that keeps delivering chunks is never swept mid-stream; a pod socket
 * dying mid-video releases its buffers after the silence instead of leaking
 * megabytes of base64 in server memory forever). Mirrors TRANSFER_STALE_MS
 * in the CloudClient pack's js/server_client_data.js. */
export const CHUNK_TRANSFER_STALE_MS = 10 * 60 * 1000;

/** One normalized chunk frame — the validated shape of a
 * `server_client_data_chunk` event's data. */
export type ClientDataChunkFrame = {
    transferId: string;
    filename: string;
    format: string;
    chunkIndex: number;
    totalChunks: number;
    /** This frame's base64 payload (raw base64, no data: URI prefix). */
    data: string;
    /** prompt_id echoed by the frame, when the sender knew it. */
    promptId: string | null;
};

/** One fully assembled chunked file — equivalent to a legacy
 * `server_client_data` file entry, ready for streamResultFromClientDataFile. */
export type CompletedChunkFile = {
    filename: string;
    format: string;
    promptId: string | null;
    /** The file's COMPLETE base64 payload (no data: URI prefix). */
    data: string;
    /** The number of frames the file was assembled from (log context). */
    totalChunks: number;
};

/**
 * Extract + validate one chunk frame from a stream event. Returns null when
 * the event is not a chunk frame or the frame is malformed — the frame is
 * not merely unviewable, it can never assemble (missing id/index/total), so
 * feeding null to an assembler is a no-op rather than an error.
 */
export function extractServerClientDataChunk(event: StreamEventLike): ClientDataChunkFrame | null {
    if (event.type !== CLIENT_DATA_CHUNK_EVENT) return null;
    const data = event.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return null;

    const transferId = data.transfer_id;
    const chunkIndex = data.chunk_index;
    const totalChunks = data.total_chunks;
    const payload = data.data;

    // A frame without these can never assemble — required metadata.
    if (typeof transferId !== 'string' || !transferId) return null;
    if (typeof chunkIndex !== 'number' || !Number.isInteger(chunkIndex) || chunkIndex < 0) return null;
    if (typeof totalChunks !== 'number' || !Number.isInteger(totalChunks) || totalChunks < 1) return null;
    if (chunkIndex >= totalChunks) return null;
    if (typeof payload !== 'string' || !payload) return null;

    return {
        transferId,
        filename: typeof data.filename === 'string' ? data.filename : '',
        format: typeof data.format === 'string' ? data.format.toLowerCase() : '',
        chunkIndex,
        totalChunks,
        data: payload,
        promptId: typeof data.prompt_id === 'string' && data.prompt_id ? data.prompt_id : null
    };
}

/**
 * Stateful reassembler for chunked `server_client_data_chunk` transfers.
 *
 * Feed every extracted frame to `push`; it returns the transfers that just
 * COMPLETED (usually zero, occasionally one). Transfers stay isolated even
 * when several generations interleave on one shared pod websocket — frames
 * are keyed by `transfer_id` and never mixed.
 *
 * Guarantees & memory behaviour:
 *   - Assembly is by SLOT (chunk_index), not arrival order — a pod's
 *     persistent socket delivers text frames in arrival order, but the
 *     assembler tolerates any reordering anyway. Duplicate frames for the
 *     same slot are ignored (first base64 wins), so a re-sent final frame
 *     cannot corrupt or duplicate the assembled bytes.
 *   - Chunks arriving BEFORE the transfer's first frame (chunk 0) cannot
 *     assemble without knowing the slot count context — they are buffered
 *     anyway and dropped if chunk 0 never shows up before the stale sweep,
 *     so a lost first frame cannot leak its megabytes.
 *   - A transfer is swept when MORE THAN `staleMs` (10 min default,
 *     mirroring the CloudClient js receiver) elapsed since its LAST frame
 *     (activity-based): long-running transfers that keep streaming are
 *     never dropped mid-file, but a pod socket that dies mid-video sweeps
 *     everything it buffered instead of leaking. Runs on every push and
 *     `prune` call.
 *   - A COMPLETED transfer is created fresh per completion, never reused,
 *     so a second run with the same transfer_id (impossible with uuid4,
 *     but defensive) cannot inherit older slots.
 */
export type ClientDataChunkAssembler = {
    /** Feed one frame (null = not a chunk / malformed — a no-op). Returns
     * the files that just completed, in completion order. */
    push(frame: ClientDataChunkFrame | null): CompletedChunkFile[];
    /** Drop transfers idle past `staleMs` (internal default). Call on any
     * tick alongside push; push runs it automatically. */
    prune(now?: number): void;
};

export function createChunkAssembler(staleMs: number = CHUNK_TRANSFER_STALE_MS): ClientDataChunkAssembler {
    // transfer_id → slot buffer. Fresh per assembler; the server-side
    // background processor creates one per generation, and completed
    // transfers are deleted as soon as the file is returned, so a shared
    // websocket's interleaved transfers never inherit each other's slots.
    const transfers = new Map<
        string,
        {
            filename: string;
            format: string;
            promptId: string | null;
            /** Base64 payload per slot; null until that slot's frame arrives. */
            chunks: (string | null)[];
            /** How many slots are filled (fast completion check). */
            received: number;
            /** Activity marker for the stale sweep — refreshed on EVERY
             * frame so long-running transfers are never swept mid-stream. */
            lastSeen: number;
        }
    >();

    const prune = (now: number = Date.now()): void => {
        for (const [transferId, transfer] of transfers) {
            if (now - transfer.lastSeen > staleMs) transfers.delete(transferId);
        }
    };

    const push = (frame: ClientDataChunkFrame | null): CompletedChunkFile[] => {
        prune();
        if (!frame) return []; // malformed/not-a-chunk frame — a no-op, not an error

        let transfer = transfers.get(frame.transferId);
        if (!transfer) {
            // First frame of a fresh transfer. Any chunk_index is accepted as
            // the opener (a reordered stream may deliver a middle chunk
            // first); the slot array is sized to total_chunks so the transfer
            // can complete regardless of where frames land.
            transfer = {
                filename: frame.filename,
                format: frame.format,
                promptId: frame.promptId,
                chunks: new Array<string | null>(frame.totalChunks).fill(null),
                received: 0,
                lastSeen: Date.now()
            };
            transfers.set(frame.transferId, transfer);
        }
        // Activity marker refresh — the transfer is alive whenever a frame
        // for it (even a duplicate) arrives; staleness measures SILENCE.
        transfer.lastSeen = Date.now();

        // Duplicate/out-of-range slot — ignore (first base64 wins; the
        // frames were normalized upstream, so slot bounds already hold).
        if (frame.chunkIndex >= transfer.chunks.length || transfer.chunks[frame.chunkIndex] !== null) return [];

        transfer.chunks[frame.chunkIndex] = frame.data;
        transfer.received += 1;

        if (transfer.received !== transfer.chunks.length) return []; // still assembling

        // Complete: concatenate the base64 payloads IN SLOT ORDER and drop
        // the transfer. Every slice was encoded independently on a
        // multiple-of-3 byte boundary (RAW_CHUNK_SIZE constraint in
        // streaming.py), so plain concatenation reconstructs the original
        // byte stream exactly.
        const totalChunks = transfer.chunks.length;
        transfers.delete(frame.transferId);
        return [{
            filename: transfer.filename,
            format: transfer.format,
            promptId: transfer.promptId,
            data: transfer.chunks.join(''),
            totalChunks
        }];
    };

    return { push, prune };
}
