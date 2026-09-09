import type { DocumentRef, ReaderSnapshot } from '../../native/contracts';

export interface ReaderResponseGateState {
  pendingOpen: {
    openRequestId: string;
    document: DocumentRef;
  } | null;
  activeReader: {
    readerSessionId: string;
    document: DocumentRef;
    latestStateRevision: number;
    snapshot: ReaderSnapshot;
  } | null;
}

export type ReaderResponse =
  | {
      kind: 'open';
      openRequestId: string;
      snapshot: ReaderSnapshot;
    }
  | {
      kind: 'session';
      snapshot: ReaderSnapshot;
    };

export type ReaderResponseRejectionReason =
  | 'invalid-response'
  | 'no-pending-open'
  | 'stale-open-request'
  | 'open-in-progress'
  | 'no-active-reader'
  | 'stale-reader-session'
  | 'document-mismatch'
  | 'stale-state-revision';

export type ReaderResponseDecision =
  | {
      accepted: true;
      state: ReaderResponseGateState;
      snapshot: ReaderSnapshot;
    }
  | {
      accepted: false;
      state: ReaderResponseGateState;
      reason: ReaderResponseRejectionReason;
    };

export const emptyReaderResponseGateState: ReaderResponseGateState = Object.freeze({
  pendingOpen: null,
  activeReader: null,
});

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function sameDocument(left: DocumentRef, right: DocumentRef): boolean {
  return left.fileId === right.fileId && left.revision === right.revision;
}

function isValidDocument(document: DocumentRef): boolean {
  return isNonEmptyString(document.fileId) && isNonEmptyString(document.revision);
}

function isValidSnapshot(snapshot: ReaderSnapshot): boolean {
  return (
    isNonEmptyString(snapshot.readerSessionId) &&
    isValidDocument(snapshot.document) &&
    Number.isSafeInteger(snapshot.stateRevision) &&
    snapshot.stateRevision >= 0 &&
    Number.isSafeInteger(snapshot.pageCount) &&
    snapshot.pageCount > 0 &&
    Number.isSafeInteger(snapshot.pageIndex) &&
    snapshot.pageIndex >= 0 &&
    snapshot.pageIndex < snapshot.pageCount &&
    ['ready', 'navigating', 'suspended', 'closed', 'error'].includes(snapshot.state)
  );
}

function cloneDocument(document: DocumentRef): DocumentRef {
  return { fileId: document.fileId, revision: document.revision };
}

export function beginReaderOpen(
  state: ReaderResponseGateState,
  openRequestId: string,
  document: DocumentRef,
): ReaderResponseGateState {
  if (!isNonEmptyString(openRequestId)) {
    throw new TypeError('openRequestId must be a non-empty string.');
  }

  if (!isValidDocument(document)) {
    throw new TypeError('document must contain non-empty fileId and revision values.');
  }

  return {
    pendingOpen: {
      openRequestId,
      document: cloneDocument(document),
    },
    // Starting B immediately retires A. Events from A cannot affect B while B loads.
    activeReader: null,
  };
}

export function closeReaderResponseGate(): ReaderResponseGateState {
  return { pendingOpen: null, activeReader: null };
}

export function applyReaderResponse(
  state: ReaderResponseGateState,
  response: ReaderResponse,
): ReaderResponseDecision {
  if (!isValidSnapshot(response.snapshot)) {
    return { accepted: false, state, reason: 'invalid-response' };
  }

  if (response.kind === 'open') {
    if (state.pendingOpen === null) {
      return { accepted: false, state, reason: 'no-pending-open' };
    }

    if (response.openRequestId !== state.pendingOpen.openRequestId) {
      return { accepted: false, state, reason: 'stale-open-request' };
    }

    if (!sameDocument(response.snapshot.document, state.pendingOpen.document)) {
      return { accepted: false, state, reason: 'document-mismatch' };
    }

    return {
      accepted: true,
      state: {
        pendingOpen: null,
        activeReader: {
          readerSessionId: response.snapshot.readerSessionId,
          document: cloneDocument(response.snapshot.document),
          latestStateRevision: response.snapshot.stateRevision,
          snapshot: response.snapshot,
        },
      },
      snapshot: response.snapshot,
    };
  }

  if (state.pendingOpen !== null) {
    return { accepted: false, state, reason: 'open-in-progress' };
  }

  if (state.activeReader === null) {
    return { accepted: false, state, reason: 'no-active-reader' };
  }

  if (response.snapshot.readerSessionId !== state.activeReader.readerSessionId) {
    return { accepted: false, state, reason: 'stale-reader-session' };
  }

  if (!sameDocument(response.snapshot.document, state.activeReader.document)) {
    return { accepted: false, state, reason: 'document-mismatch' };
  }

  if (response.snapshot.stateRevision <= state.activeReader.latestStateRevision) {
    return { accepted: false, state, reason: 'stale-state-revision' };
  }

  return {
    accepted: true,
    state: {
      pendingOpen: null,
      activeReader: {
        ...state.activeReader,
        latestStateRevision: response.snapshot.stateRevision,
        snapshot: response.snapshot,
      },
    },
    snapshot: response.snapshot,
  };
}

