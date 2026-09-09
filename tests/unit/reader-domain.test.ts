import { describe, expect, it } from 'vitest';

import {
  applyReaderResponse,
  beginReaderOpen,
  closeReaderResponseGate,
  displayPageNumberToIndex,
  emptyReaderResponseGateState,
  pageIndexToDisplayNumber,
  parseDisplayPageInput,
} from '../../src/domain/reader';
import type {
  DocumentRef,
  ReaderSnapshot,
  ReaderState,
} from '../../src/native/contracts';

const DOCUMENT_A: DocumentRef = { fileId: 'file-a', revision: 'revision-a' };
const DOCUMENT_B: DocumentRef = { fileId: 'file-b', revision: 'revision-b' };

function snapshot(
  readerSessionId: string,
  document: DocumentRef,
  stateRevision: number,
  pageIndex = 0,
  pageCount = 10,
  state: ReaderState = 'ready',
): ReaderSnapshot {
  return {
    readerSessionId,
    document,
    stateRevision,
    pageIndex,
    pageCount,
    state,
  };
}

describe('reader zero/one-based page conversion', () => {
  it('converts first, middle and 10,000th pages exactly', () => {
    expect(pageIndexToDisplayNumber(0, 10_000)).toBe(1);
    expect(pageIndexToDisplayNumber(4_999, 10_000)).toBe(5_000);
    expect(pageIndexToDisplayNumber(9_999, 10_000)).toBe(10_000);
    expect(displayPageNumberToIndex(1, 10_000)).toBe(0);
    expect(displayPageNumberToIndex(5_000, 10_000)).toBe(4_999);
    expect(displayPageNumberToIndex(10_000, 10_000)).toBe(9_999);
  });

  it('rejects invalid page counts, indexes and display numbers instead of clamping', () => {
    expect(() => pageIndexToDisplayNumber(-1, 10)).toThrow(RangeError);
    expect(() => pageIndexToDisplayNumber(10, 10)).toThrow(RangeError);
    expect(() => pageIndexToDisplayNumber(0, 0)).toThrow(RangeError);
    expect(() => displayPageNumberToIndex(0, 10)).toThrow(RangeError);
    expect(() => displayPageNumberToIndex(11, 10)).toThrow(RangeError);
    expect(() => displayPageNumberToIndex(1.5, 10)).toThrow(RangeError);
  });

  it('parses full-width and zero-padded integer text safely', () => {
    expect(parseDisplayPageInput(' ００１４ ', 240)).toEqual({ ok: true, value: 13 });
    expect(parseDisplayPageInput('240', 240)).toEqual({ ok: true, value: 239 });
  });

  it.each([
    ['', 'empty'],
    ['  ', 'empty'],
    ['1.5', 'not-integer'],
    ['+2', 'not-integer'],
    ['1e2', 'not-integer'],
    ['2ページ', 'not-integer'],
    ['0', 'out-of-range'],
    ['241', 'out-of-range'],
    ['9007199254740992', 'unsafe-integer'],
  ] as const)('rejects page input %j as %s', (input, code) => {
    expect(parseDisplayPageInput(input, 240)).toEqual({ ok: false, code });
  });
});

describe('stale reader response rejection', () => {
  it('rejects slow open A after open B became the current request', () => {
    const loadingA = beginReaderOpen(emptyReaderResponseGateState, 'open-a', DOCUMENT_A);
    const loadingB = beginReaderOpen(loadingA, 'open-b', DOCUMENT_B);
    const staleA = applyReaderResponse(loadingB, {
      kind: 'open',
      openRequestId: 'open-a',
      snapshot: snapshot('reader-a', DOCUMENT_A, 0),
    });

    expect(staleA).toEqual({
      accepted: false,
      state: loadingB,
      reason: 'stale-open-request',
    });

    const acceptedB = applyReaderResponse(loadingB, {
      kind: 'open',
      openRequestId: 'open-b',
      snapshot: snapshot('reader-b', DOCUMENT_B, 0),
    });
    expect(acceptedB.accepted).toBe(true);
    if (acceptedB.accepted) {
      expect(acceptedB.state.activeReader?.readerSessionId).toBe('reader-b');
    }
  });

  it('rejects old sessions and document revisions after an open is accepted', () => {
    const loading = beginReaderOpen(emptyReaderResponseGateState, 'open-a', DOCUMENT_A);
    const opened = applyReaderResponse(loading, {
      kind: 'open',
      openRequestId: 'open-a',
      snapshot: snapshot('reader-a', DOCUMENT_A, 2),
    });
    expect(opened.accepted).toBe(true);
    if (!opened.accepted) {
      throw new Error('test setup failed');
    }

    expect(
      applyReaderResponse(opened.state, {
        kind: 'session',
        snapshot: snapshot('retired-reader', DOCUMENT_A, 3),
      }),
    ).toMatchObject({ accepted: false, reason: 'stale-reader-session' });
    expect(
      applyReaderResponse(opened.state, {
        kind: 'session',
        snapshot: snapshot('reader-a', { ...DOCUMENT_A, revision: 'changed' }, 3),
      }),
    ).toMatchObject({ accepted: false, reason: 'document-mismatch' });
  });

  it('applies only monotonically newer state revisions', () => {
    const loading = beginReaderOpen(emptyReaderResponseGateState, 'open-a', DOCUMENT_A);
    const opened = applyReaderResponse(loading, {
      kind: 'open',
      openRequestId: 'open-a',
      snapshot: snapshot('reader-a', DOCUMENT_A, 10),
    });
    if (!opened.accepted) {
      throw new Error('test setup failed');
    }

    for (const stateRevision of [9, 10]) {
      expect(
        applyReaderResponse(opened.state, {
          kind: 'session',
          snapshot: snapshot('reader-a', DOCUMENT_A, stateRevision),
        }),
      ).toMatchObject({ accepted: false, reason: 'stale-state-revision' });
    }

    const newer = applyReaderResponse(opened.state, {
      kind: 'session',
      snapshot: snapshot('reader-a', DOCUMENT_A, 11, 1),
    });
    expect(newer).toMatchObject({
      accepted: true,
      state: { activeReader: { latestStateRevision: 11 } },
      snapshot: { pageIndex: 1 },
    });
  });

  it('rejects session events while a new document is loading', () => {
    const loading = beginReaderOpen(emptyReaderResponseGateState, 'open-b', DOCUMENT_B);
    expect(
      applyReaderResponse(loading, {
        kind: 'session',
        snapshot: snapshot('old-reader', DOCUMENT_A, 99),
      }),
    ).toMatchObject({ accepted: false, reason: 'open-in-progress' });
  });

  it('rejects malformed responses and mismatched open documents', () => {
    const loading = beginReaderOpen(emptyReaderResponseGateState, 'open-a', DOCUMENT_A);
    expect(
      applyReaderResponse(loading, {
        kind: 'open',
        openRequestId: 'open-a',
        snapshot: snapshot('reader-a', DOCUMENT_B, 0),
      }),
    ).toMatchObject({ accepted: false, reason: 'document-mismatch' });
    expect(
      applyReaderResponse(loading, {
        kind: 'open',
        openRequestId: 'open-a',
        snapshot: snapshot('reader-a', DOCUMENT_A, 0, 10, 10),
      }),
    ).toMatchObject({ accepted: false, reason: 'invalid-response' });
  });

  it('validates open inputs and closes without retaining stale identity', () => {
    expect(() => beginReaderOpen(emptyReaderResponseGateState, '', DOCUMENT_A)).toThrow(
      TypeError,
    );
    expect(() =>
      beginReaderOpen(emptyReaderResponseGateState, 'open', { fileId: '', revision: 'r' }),
    ).toThrow(TypeError);
    expect(closeReaderResponseGate()).toEqual({ pendingOpen: null, activeReader: null });
  });
});

