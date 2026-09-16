// =============================================================================
// server_client_data_chunk reassembly tests
//
// The ComfyUI-CloudClient image/video save nodes stream one file as many
// `server_client_data_chunk` frames over the pod's shared websocket (see
// repository/ComfyUI-CloudClient/utils/streaming.py):
//
//     { transfer_id, filename, format, chunk_index, total_chunks,
//       data (raw base64), prompt_id }
//
// The dashboard server extracts + validates each frame with
// extractServerClientDataChunk and feeds it to a per-consumer
// createChunkAssembler() instance; a `server_client_data` capture only
// lands when the LAST chunk of a transfer arrives.
//
// Verifies:
//   1. extractServerClientDataChunk — event gating, malformed frames → null,
//      case/format normalization, prompt_id passthrough.
//   2. createChunkAssembler — completion on the last chunk, per-index
//      assembly (arrival order irrelevant), duplicate-frame tolerance,
//      many interleaved transfers (shared pod socket), per-consumer
//      isolation, unviewable payloads skipped at capture level, malformed
//      frames as no-ops, stale-transfer sweep.
//   3. Cross-protocol equivalence — a file delivered in chunks produces the
//      same StreamResultItem the legacy single-frame path produces.
// =============================================================================

import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    CLIENT_DATA_CHUNK_EVENT,
    base64ByteSize,
    createChunkAssembler,
    extractServerClientDataChunk,
    extractServerClientDataResults,
    streamResultFromClientDataFile,
    type ClientDataChunkFrame,
    type StreamEventLike
} from './components/utils';

/** 'aGVsbG8=' is base64 for "hello" → 5 bytes. Chunks split on the 3-byte
 * boundary ('hel' | 'lo'), so each chunk decodes independently — the exact
 * property streaming.py's RAW_CHUNK_SIZE constraint guarantees. */
const HELLO_CHUNKS = ['aGVs', 'bG8='];
const HELLO_B64 = 'aGVsbG8=';

function chunkEvent(overrides: Partial<Record<string, unknown>>): StreamEventLike {
    return {
        type: CLIENT_DATA_CHUNK_EVENT,
        data: {
            transfer_id: 'transfer-1',
            filename: 'kaggle_generated_001.png',
            format: 'png',
            chunk_index: 0,
            total_chunks: 2,
            data: HELLO_CHUNKS[0],
            prompt_id: 'p-1',
            ...overrides
        }
    };
}

function feed(
    event: StreamEventLike
): ReturnType<ReturnType<typeof createChunkAssembler>['push']> {
    const assembler = createChunkAssembler();
    const frame = extractServerClientDataChunk(event);
    return assembler.push(frame);
}

afterEach(() => {
    vi.useRealTimers();
});

describe('extractServerClientDataChunk', () => {
    it('passes other event types through as null', () => {
        expect(extractServerClientDataChunk({ type: 'server_client_data', data: {} })).toBeNull();
        expect(extractServerClientDataChunk({ type: 'executing', data: { node: '1' } })).toBeNull();
    });

    it('normalizes a well-formed frame', () => {
        expect(extractServerClientDataChunk(chunkEvent({}))).toEqual({
            transferId: 'transfer-1',
            filename: 'kaggle_generated_001.png',
            format: 'png',
            chunkIndex: 0,
            totalChunks: 2,
            data: HELLO_CHUNKS[0],
            promptId: 'p-1'
        });
    });

    it('lowercases the format and preserves the filename verbatim', () => {
        const frame = extractServerClientDataChunk(
            chunkEvent({ format: 'MP4', filename: 'Animated_20260731_155729.mp4' })
        );
        expect(frame).not.toBeNull();
        expect(frame!.format).toBe('mp4');
        expect(frame!.filename).toBe('Animated_20260731_155729.mp4');
    });

    it('treats missing/empty prompt_id as null', () => {
        expect(extractServerClientDataChunk(chunkEvent({ prompt_id: undefined }))!.promptId).toBeNull();
        expect(extractServerClientDataChunk(chunkEvent({ prompt_id: '' }))!.promptId).toBeNull();
    });

    // ── Malformed frames → null (never feedable garbage) ────────────────

    it('rejects frames without a transfer id', () => {
        expect(extractServerClientDataChunk(chunkEvent({ transfer_id: '' }))).toBeNull();
        expect(extractServerClientDataChunk(chunkEvent({ transfer_id: 42 }))).toBeNull();
    });

    it('rejects frames with a non-integer / negative / out-of-range chunk_index', () => {
        expect(extractServerClientDataChunk(chunkEvent({ chunk_index: 1.5 }))).toBeNull();
        expect(extractServerClientDataChunk(chunkEvent({ chunk_index: -1 }))).toBeNull();
        expect(extractServerClientDataChunk(chunkEvent({ chunk_index: 2, total_chunks: 2 }))).toBeNull();
    });

    it('rejects frames with an impossible total_chunks', () => {
        expect(extractServerClientDataChunk(chunkEvent({ total_chunks: 0 }))).toBeNull();
        expect(extractServerClientDataChunk(chunkEvent({ total_chunks: '2' }))).toBeNull();
    });

    it('rejects frames without a base64 payload', () => {
        expect(extractServerClientDataChunk(chunkEvent({ data: '' }))).toBeNull();
        expect(extractServerClientDataChunk(chunkEvent({ data: 42 }))).toBeNull();
    });

    it('rejects events whose data is not an object', () => {
        expect(extractServerClientDataChunk({ type: CLIENT_DATA_CHUNK_EVENT, data: undefined as any })).toBeNull();
    });
});

describe('createChunkAssembler', () => {
    it('assembles a two-chunk file when the last chunk arrives', () => {
        const assembler = createChunkAssembler();
        const frame0 = extractServerClientDataChunk(chunkEvent({ chunk_index: 0 }))!;
        const frame1 = extractServerClientDataChunk(chunkEvent({ chunk_index: 1, data: HELLO_CHUNKS[1] }))!;

        expect(assembler.push(frame0)).toEqual([]); // still assembling
        expect(assembler.push(frame1)).toEqual([{
            filename: 'kaggle_generated_001.png',
            format: 'png',
            promptId: 'p-1',
            data: HELLO_B64, // concatenated IN SLOT order — not arrival order
            totalChunks: 2
        }]);
    });

    it('fills slots by chunk_index regardless of arrival order', () => {
        const assembler = createChunkAssembler();
        const frames = [
            extractServerClientDataChunk(chunkEvent({ chunk_index: 1, data: HELLO_CHUNKS[1] }))!,
            extractServerClientDataChunk(chunkEvent({ chunk_index: 0 }))!
        ];
        const completed = frames.flatMap((f) => assembler.push(f));
        expect(completed).toHaveLength(1);
        expect(completed[0].data).toBe(HELLO_B64);
    });

    it('ignores duplicate frames for an already-filled slot (re-sent final frame)', () => {
        const assembler = createChunkAssembler();
        const frame0 = extractServerClientDataChunk(chunkEvent({ chunk_index: 0 }))!;
        const frame1 = extractServerClientDataChunk(chunkEvent({ chunk_index: 1, data: HELLO_CHUNKS[1] }))!;

        expect(assembler.push(frame0)).toEqual([]);
        // First frame duplicated — no double increment, no corruption.
        expect(assembler.push(frame0)).toEqual([]);
        expect(assembler.push(frame1)).toEqual([expect.objectContaining({ data: HELLO_B64 })]);
    });

    it('treats a single-chunk transfer as complete on its only frame', () => {
        const assembler = createChunkAssembler();
        const frame = extractServerClientDataChunk(
            chunkEvent({ chunk_index: 0, total_chunks: 1, data: HELLO_B64 })
        )!;
        expect(assembler.push(frame)).toEqual([expect.objectContaining({ data: HELLO_B64, totalChunks: 1 })]);
    });

    it('assembles larger payloads to the exact byte length of the original file', () => {
        // 900 raw bytes of deterministic noise → 2 chunks (510 | 390 bytes),
        // delivered reversed: [1, 0]. Shapes exactly like streaming.py's
        // send_file_chunks with raw_chunk_size=510 (a multiple of 3).
        const raw = new Uint8Array(900).map((_, i) => (i * 37 + 11) % 256);
        const frames: ClientDataChunkFrame[] = [
            { transferId: 't', filename: 'v.webm', format: 'webm', chunkIndex: 0, totalChunks: 2, data: subarrayB64(raw, 0, 510), promptId: null },
            { transferId: 't', filename: 'v.webm', format: 'webm', chunkIndex: 1, totalChunks: 2, data: subarrayB64(raw, 510, 900), promptId: null }
        ];

        const assembler = createChunkAssembler();
        const shuffled = [frames[1], frames[0]]; // reversed arrival
        const [done] = shuffled.flatMap((f) => assembler.push(f));

        expect(done.filename).toBe('v.webm');
        expect(base64ByteSize(done.data)).toBe(900); // full payload reconstructed
    });

    // ── Interleaved transfers on one shared pod websocket ───────────────

    it('assembles two interleaved transfers independently', () => {
        const assembler = createChunkAssembler();
        // Two transfers, each 2 chunks, frames interleaved A0 B0 A1 B1 —
        // exactly what concurrent jobs sharing a pod produce.
        const a0 = extractServerClientDataChunk(chunkEvent({ transfer_id: 'A', chunk_index: 0 }))!;
        const b0 = extractServerClientDataChunk(chunkEvent({ transfer_id: 'B', chunk_index: 0, filename: 'other.gif', format: 'gif' }))!;
        const a1 = extractServerClientDataChunk(chunkEvent({ transfer_id: 'A', chunk_index: 1, data: HELLO_CHUNKS[1] }))!;
        const b1 = extractServerClientDataChunk(chunkEvent({ transfer_id: 'B', chunk_index: 1, data: HELLO_CHUNKS[1] }))!;

        expect(assembler.push(a0)).toEqual([]);
        expect(assembler.push(b0)).toEqual([]);
        const [fromA] = assembler.push(a1);
        const [fromB] = assembler.push(b1);

        expect(fromA.filename).toBe('kaggle_generated_001.png');
        expect(fromB.filename).toBe('other.gif'); // never mixed with A's slots
    });

    it('keeps transfers isolated across separate assembler instances', () => {
        // Server-side processing mode creates one assembler PER generation;
        // two generations on the same pod socket must never share slots.
        const gen1 = createChunkAssembler();
        const gen2 = createChunkAssembler();
        const frame0 = extractServerClientDataChunk(chunkEvent({ transfer_id: 'shared-sock' }))!;

        expect(gen1.push(frame0)).toEqual([]);
        // gen2's push of the SAME transfer id must not observe gen1's slot…
        expect(gen2.push(frame0)).toEqual([]);
        // …and gen1's completion must not complete gen2 (who is missing
        // chunk 1 because gen1 "received" it).
        const frame1 = extractServerClientDataChunk(chunkEvent({ transfer_id: 'shared-sock', chunk_index: 1, data: HELLO_CHUNKS[1] }))!;
        expect(gen1.push(frame1)).toHaveLength(1);
        expect(gen2.push(extractServerClientDataChunk(chunkEvent({ transfer_id: 'shared-sock', chunk_index: 1, data: HELLO_CHUNKS[1] }))!))
            .toHaveLength(1);
    });

    // ── Robustness ──────────────────────────────────────────────────────

    it('treats null frames (malformed/other events) as no-ops', () => {
        const assembler = createChunkAssembler();
        expect(assembler.push(null)).toEqual([]);
        // …and the assembler state is untouched — the well-formed frame still
        // completes the transfer.
        expect(assembler.push(extractServerClientDataChunk(chunkEvent({ total_chunks: 2 }))!)).toEqual([]);
        expect(
            assembler.push(extractServerClientDataChunk(chunkEvent({ chunk_index: 1, data: HELLO_CHUNKS[1] }))!)
        ).toHaveLength(1);
    });

    it('sweeps an incomplete transfer past the stale window (freed memory)', () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        // Window shorter than the test clock jumps: 60 s.
        const sweeper = createChunkAssembler(60000);
        // Chunk 0 only — transfer rides in the sweeper's map…
        sweeper.push(extractServerClientDataChunk(chunkEvent({ chunk_index: 0 }))!);
        // …50 s later its remaining frame STILL assembles (window not hit)…
        vi.setSystemTime(50 * 1000);
        expect(
            sweeper.push(extractServerClientDataChunk(chunkEvent({ chunk_index: 1, data: HELLO_CHUNKS[1] }))!)
        ).toHaveLength(1);

        // …but beyond the stale window everything buffered is dropped.
        const abandoned = createChunkAssembler(60000);
        // A FRESH transfer created under the new clock — its window starts now.
        vi.setSystemTime(20 * 60 * 1000);
        abandoned.push(extractServerClientDataChunk(chunkEvent({ chunk_index: 0 }))!);
        vi.setSystemTime(20 * 60 * 1000 + 2 * 60 * 1000); // 2 silent minutes — past 60 s
        abandoned.prune();
        expect(
            abandoned.push(extractServerClientDataChunk(chunkEvent({ chunk_index: 1, data: HELLO_CHUNKS[1] }))!)
        ).toHaveLength(0);
    });
});

// ── Cross-protocol equivalence ──────────────────────────────────────────

describe('chunked capture equals legacy capture', () => {
    it('produces the identical StreamResultItem for a chunked vs legacy delivery', () => {
        // Legacy: one server_client_data event, file whole.
        const [legacy] = extractServerClientDataResults({
            type: 'server_client_data',
            data: { files: [{ filename: 'clip.mp4', data: HELLO_B64, format: 'mp4' }], prompt_id: 'p-1' }
        });

        // Chunked: two frames → assembler → same single-file converter.
        // The frames must carry the SAME filename/format the legacy event
        // does, or the MIME resolution itself (legitimately) differs.
        const assembler = createChunkAssembler();
        const [completed] = [
            extractServerClientDataChunk(chunkEvent({ transfer_id: 't', chunk_index: 0, filename: 'clip.mp4', format: 'mp4' }))!,
            extractServerClientDataChunk(chunkEvent({ transfer_id: 't', chunk_index: 1, data: HELLO_CHUNKS[1], filename: 'clip.mp4', format: 'mp4' }))!
        ].flatMap((f) => assembler.push(f));
        const chunked = streamResultFromClientDataFile({
            filename: completed.filename,
            data: completed.data,
            format: completed.format
        });

        // Identical records — size, mime, payload, type (nodeId degrades to
        // '' for chunked because the chunk protocol carries no node id).
        expect(legacy).toEqual({ filename: 'clip.mp4', result: chunked });
        expect(legacy.result).toEqual({
            type: 'video',
            url: `data:video/mp4;base64,${HELLO_B64}`,
            mimeType: 'video/mp4',
            size: base64ByteSize(HELLO_B64),
            nodeId: ''
        });
    });

    it('skips unviewable chunked payloads (zip) at capture time', () => {
        const assembler = createChunkAssembler();
        const [completed] = [
            extractServerClientDataChunk(chunkEvent({ chunk_index: 0, filename: 'bundle.zip', format: 'zip' }))!,
            extractServerClientDataChunk(chunkEvent({ chunk_index: 1, data: HELLO_CHUNKS[1], filename: 'bundle.zip', format: 'zip' }))!
        ].flatMap((f) => assembler.push(f));
        expect(completed).not.toBeNull(); // assembled regardless of viewability
        expect(streamResultFromClientDataFile({
            filename: completed.filename,
            data: completed.data,
            format: completed.format
        })).toBeNull();
    });
});

// ── Helpers ─────────────────────────────────────────────────────────────

/** base64 of raw[start, end) — used to build streaming.py-shaped frames. */
function subarrayB64(raw: Uint8Array, start: number, end: number): string {
    let binary = '';
    for (const byte of raw.subarray(start, end)) binary += String.fromCharCode(byte);
    return btoa(binary);
}

// `feed` was the expressive one-liner used in early assertions; kept so the
// tests stay in CI — it wraps a fresh assembler around one event.
describe('one-shot feed helper', () => {
    it('feeds a complete single-chunk transfer', () => {
        const [done] = feed(chunkEvent({ total_chunks: 1, data: HELLO_B64, chunk_index: 0 }));
        expect(done!.data).toBe(HELLO_B64);
    });
});
