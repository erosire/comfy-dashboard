// =============================================================================
// server_client_data stream-result extraction tests
//
// The ComfyUI-CloudClient save nodes (ClientImageSaveNode / ClientVideoSaveNode
// / FileCompressor) emit `server_client_data` events via PromptServer.send_sync
// with { files: [{ filename, data (raw base64), format }], prompt_id }. The
// stream consumer (the server-side cloud-prompt background processor) turns
// these into generation results through extractServerClientDataResults.
//
// Verifies:
//   1. Non-server_client_data events produce nothing.
//   2. MP4/WEBM files become type 'video' results with a data: URL payload.
//   3. PNG/JPEG/GIF files become type 'image' results.
//   4. `format` wins; the filename extension is the fallback; payloads that
//      already ARE data: URIs are parsed back to mime + payload.
//   5. Non-viewable payloads (zip…) and malformed entries are skipped.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { extractServerClientDataResults, base64ByteSize } from './components/utils';

/** 'aGVsbG8=' is base64 for "hello" → 5 bytes. */
const HELLO_B64 = 'aGVsbG8=';

function makeEvent(files: unknown): { type: string; data: Record<string, unknown> } {
    return {
        type: 'server_client_data',
        data: { files, prompt_id: 'p-1' }
    };
}

describe('extractServerClientDataResults', () => {
    // ── 1. Event-shape gating ───────────────────────────────────────────

    it('returns nothing for other event types', () => {
        const event = { type: 'imagepreview.update', data: { image: 'data:image/png;base64,AAAA' } };
        expect(extractServerClientDataResults(event)).toEqual([]);
    });

    it('returns nothing when `files` is missing or not an array', () => {
        expect(extractServerClientDataResults({ type: 'server_client_data', data: {} })).toEqual([]);
        expect(extractServerClientDataResults(makeEvent('nope'))).toEqual([]);
        expect(extractServerClientDataResults(makeEvent([]))).toEqual([]);
    });

    // ── 2 & 3. Video and image capture ─────────────────────────────────

    it('captures an mp4 file as a video result (ClientVideoSaveNode shape)', () => {
        // Mirrors Animated_20260731_155729.mp4 — "AAAAIGZ0eXB…" is an MP4 header.
        const payload = 'AAAAIGZ0eXBpc29tAAACAGlzb21p';
        const [out] = extractServerClientDataResults(
            makeEvent([{ filename: 'Animated_20260731_155729.mp4', data: payload, format: 'mp4' }])
        );

        expect(out.result.type).toBe('video');
        expect(out.result.mimeType).toBe('video/mp4');
        expect(out.result.url).toBe(`data:video/mp4;base64,${payload}`);
        expect(out.result.size).toBe(base64ByteSize(payload));
        expect(out.filename).toBe('Animated_20260731_155729.mp4');
    });

    it('captures webm as video and png/jpeg/gif as images', () => {
        const out = extractServerClientDataResults(
            makeEvent([
                { filename: 'a.webm', data: HELLO_B64, format: 'webm' },
                { filename: 'b.png', data: HELLO_B64, format: 'png' },
                { filename: 'c.jpeg', data: HELLO_B64, format: 'jpeg' },
                { filename: 'd.gif', data: HELLO_B64, format: 'gif' }
            ])
        );
        expect(out.map((f) => [f.result.type, f.result.mimeType])).toEqual([
            ['video', 'video/webm'],
            ['image', 'image/png'],
            ['image', 'image/jpeg'],
            ['image', 'image/gif']
        ]);
        expect(out).toHaveLength(4);
        expect(out[0].result.size).toBe(5); // "hello"
    });

    it('captures mp3/wav files as audio results', () => {
        const out = extractServerClientDataResults(
            makeEvent([
                { filename: 'track.mp3', data: HELLO_B64, format: 'mp3' },
                { filename: 'tone.wav', data: HELLO_B64, format: 'wav' }
            ])
        );
        expect(out.map((f) => [f.result.type, f.result.mimeType])).toEqual([
            ['audio', 'audio/mpeg'],
            ['audio', 'audio/wav']
        ]);
        expect(out[0].result.url).toBe(`data:audio/mpeg;base64,${HELLO_B64}`);
    });

    it('captures multiple files from a single event', () => {
        const out = extractServerClientDataResults(
            makeEvent([
                { filename: 'kaggle_generated_1.png', data: HELLO_B64, format: 'png' },
                { filename: 'kaggle_generated_2.png', data: HELLO_B64, format: 'png' }
            ])
        );
        expect(out).toHaveLength(2);
    });

    // ── 4. MIME resolution ─────────────────────────────────────────────

    it('falls back to the filename extension when `format` is absent', () => {
        const [out] = extractServerClientDataResults(
            makeEvent([{ filename: 'clip.webm', data: HELLO_B64 }])
        );
        expect(out.result.mimeType).toBe('video/webm');
    });

    it('is case-insensitive about the format/extension', () => {
        const [out] = extractServerClientDataResults(
            makeEvent([{ filename: 'IMG.PNG', data: HELLO_B64, format: 'PNG' }])
        );
        expect(out.result.mimeType).toBe('image/png');
    });

    it('parses payloads that already are data: URIs', () => {
        const [out] = extractServerClientDataResults(
            makeEvent([{ filename: 'x.png', data: `data:image/png;base64,${HELLO_B64}`, format: 'png' }])
        );
        expect(out.result.mimeType).toBe('image/png');
        expect(out.result.url).toBe(`data:image/png;base64,${HELLO_B64}`);
        expect(out.result.size).toBe(5);
    });

    // ── 5. Skips ───────────────────────────────────────────────────────

    it('skips non-viewable payloads (zip, txt, …)', () => {
        const out = extractServerClientDataResults(
            makeEvent([
                { filename: 'test.zip', data: HELLO_B64, format: 'zip' },
                { filename: 'ok.png', data: HELLO_B64, format: 'png' }
            ])
        );
        expect(out).toHaveLength(1);
        expect(out[0].filename).toBe('ok.png');
    });

    it('skips entries with empty or non-string data and non-object entries', () => {
        const out = extractServerClientDataResults(
            makeEvent([null, 42, { filename: 'a.png', data: '' }, { filename: 'b.png', data: HELLO_B64, format: 'png' }])
        );
        expect(out).toHaveLength(1);
        expect(out[0].filename).toBe('b.png');
    });

    it('skips entries whose format/extension is unknown', () => {
        expect(
            extractServerClientDataResults(makeEvent([{ filename: 'blob', data: HELLO_B64 }]))
        ).toEqual([]);
    });
});
