// Result capture from pod stream events.
//
// Two event shapes carry media payloads back from a ComfyUI pod:
//
//   - `imagepreview.update` → { image: 'data:image/png;base64,…', node_id }
//     (handled inline by the consumers; small preview frames)
//
//   - `server_client_data`  → { files: [{ filename, data, format }], prompt_id }
//     Emitted by the ComfyUI-CloudClient save nodes (ClientImageSaveNode,
//     ClientVideoSaveNode, FileCompressor) via PromptServer.send_sync when
//     they "save" their output back to the caller. `data` is RAW base64
//     (no data: URI prefix) and `format` the lowercase file extension
//     ("mp4" | "webm" | "gif" | "png" | "jpeg" | "mp3" | "zip" | …).
//
// This module extracts the files of the second shape into generation-result
// items (the same structural type the generation store persists), so the
// stream consumer — the server-side background processor in
// endpoints/cloud/cloud-prompt.ts — captures them identically.

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
 * Convert a `server_client_data` stream event into generation result items —
 * one per file the event carries whose payload maps to a viewable image/*
 * or video/* MIME type.
 *
 * Non-viewable payloads (e.g. the FileCompressor's zip archive — a
 * download-flow file, not a dashboard result) are skipped, as are malformed
 * entries (empty/non-string data). Returns [] for any other event type.
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
        const filename = typeof file.filename === 'string' ? file.filename : '';
        const rawData = typeof file.data === 'string' ? file.data : '';
        if (!rawData) continue;

        let mime: string;
        let payload: string;
        if (rawData.startsWith('data:')) {
            // Defensive: an emitter that already ships a full data: URI —
            // split it back into mime + payload (re-wrapped canonically below).
            const commaIdx = rawData.indexOf(',');
            if (commaIdx === -1) continue;
            const meta = rawData.substring(0, commaIdx);
            if (!/;base64/i.test(meta)) continue;
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

        // Only viewable/playable media becomes a generation result — the
        // OUTPUT tab renders results as <img>/<video>/<audio>; other
        // payloads are skipped.
        if (!/^image\//.test(mime) && !/^video\//.test(mime) && !/^audio\//.test(mime)) continue;

        out.push({
            filename,
            result: {
                type: mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image',
                url: `data:${mime};base64,${payload}`,
                mimeType: mime,
                size: base64ByteSize(payload),
                nodeId: (data?.node_id as string) ?? ''
            }
        });
    }
    return out;
}
