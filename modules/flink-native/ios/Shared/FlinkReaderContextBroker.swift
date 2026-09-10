import Foundation

internal enum FlinkBlinkAuthorization {
  case allowed
  case stale
  case suspended
}

/// Process-local safety gate shared by the PDF and face services.
///
/// This deliberately persists nothing. Its only job is to prevent a sample or
/// command issued for an old JS runtime, reader, document, or tracking epoch
/// from affecting the currently visible PDF.
internal final class FlinkReaderContextBroker {
  static let shared = FlinkReaderContextBroker()

  private let lock = NSLock()
  private var applicationIsActive = false
  private var interactionIsSuspended = false
  private var readerSessionId: String?
  private var document: FlinkDocumentRefRecord?
  private var documentIsValid = false
  private var inputContext: FlinkInputContextRecord?
  private var trackingEpoch: String?

  private init() {}

  func setApplicationActive(_ active: Bool) {
    lock.withLock {
      applicationIsActive = active
      if !active {
        inputContext = nil
        trackingEpoch = nil
      }
    }
  }

  func setInteractionSuspended(_ suspended: Bool, readerSessionId expected: String?) {
    lock.withLock {
      guard expected == nil || expected == readerSessionId else {
        return
      }
      interactionIsSuspended = suspended
      if suspended {
        inputContext = nil
        trackingEpoch = nil
      }
    }
  }

  func activateReader(sessionId: String, document newDocument: FlinkDocumentRefRecord) {
    lock.withLock {
      readerSessionId = sessionId
      document = newDocument
      documentIsValid = true
      interactionIsSuspended = false
      inputContext = nil
      trackingEpoch = nil
    }
  }

  func closeReader(sessionId expected: String) {
    lock.withLock {
      guard readerSessionId == expected else {
        return
      }
      readerSessionId = nil
      document = nil
      documentIsValid = false
      interactionIsSuspended = false
      inputContext = nil
      trackingEpoch = nil
    }
  }

  func invalidateDocument(_ invalidated: FlinkDocumentRefRecord) {
    lock.withLock {
      guard documentsReferToSameObservation(document, invalidated) else {
        return
      }
      documentIsValid = false
      inputContext = nil
      trackingEpoch = nil
    }
  }

  func canStartTracking(_ context: FlinkInputContextRecord) -> Bool {
    lock.withLock {
      applicationIsActive &&
        !interactionIsSuspended &&
        documentIsValid &&
        readerSessionId == context.readerSessionId &&
        !context.jsRuntimeId.isEmpty &&
        !context.generation.isEmpty
    }
  }

  func bindTracking(context: FlinkInputContextRecord, trackingEpoch newEpoch: String) -> Bool {
    lock.withLock {
      guard applicationIsActive,
            !interactionIsSuspended,
            documentIsValid,
            readerSessionId == context.readerSessionId,
            !context.jsRuntimeId.isEmpty,
            !context.generation.isEmpty,
            !newEpoch.isEmpty else {
        return false
      }
      inputContext = context
      trackingEpoch = newEpoch
      return true
    }
  }

  /// Unlike `canStartTracking`, this verifies that the existing AR session is
  /// still bound to the exact context and epoch. Suspension and app-inactive
  /// transitions intentionally clear that binding even if the reader remains
  /// open and can later start a new tracking session.
  func isTrackingBound(
    context: FlinkInputContextRecord,
    trackingEpoch expectedEpoch: String
  ) -> Bool {
    lock.withLock {
      applicationIsActive &&
        !interactionIsSuspended &&
        documentIsValid &&
        readerSessionId == context.readerSessionId &&
        contextsAreEqual(inputContext, context) &&
        trackingEpoch == expectedEpoch
    }
  }

  func unbindTracking(context: FlinkInputContextRecord) {
    lock.withLock {
      guard contextsAreEqual(inputContext, context) else {
        return
      }
      inputContext = nil
      trackingEpoch = nil
    }
  }

  func authorizeBlink(
    _ request: FlinkNavigateRequestRecord,
    nativeNowMs: Double
  ) -> FlinkBlinkAuthorization {
    lock.withLock {
      guard applicationIsActive, !interactionIsSuspended, documentIsValid else {
        return .suspended
      }
      guard request.source == "blink",
            request.readerSessionId == readerSessionId,
            let requestContext = request.inputContext,
            contextsAreEqual(inputContext, requestContext),
            request.trackingEpoch == trackingEpoch,
            let sampleNativeMs = request.sampleNativeMs,
            sampleNativeMs.isFinite,
            nativeNowMs.isFinite else {
        return .stale
      }

      let ageMs = nativeNowMs - sampleNativeMs
      guard ageMs >= 0, ageMs <= 350 else {
        return .stale
      }
      return .allowed
    }
  }

  func authorizeManual(readerSessionId requestedSessionId: String) -> FlinkBlinkAuthorization {
    lock.withLock {
      guard applicationIsActive, !interactionIsSuspended, documentIsValid else {
        return .suspended
      }
      guard requestedSessionId == readerSessionId else {
        return .stale
      }
      return .allowed
    }
  }

  func reset() {
    lock.withLock {
      applicationIsActive = false
      interactionIsSuspended = false
      readerSessionId = nil
      document = nil
      documentIsValid = false
      inputContext = nil
      trackingEpoch = nil
    }
  }

  private func contextsAreEqual(
    _ left: FlinkInputContextRecord?,
    _ right: FlinkInputContextRecord
  ) -> Bool {
    guard let left else {
      return false
    }
    return left.jsRuntimeId == right.jsRuntimeId &&
      left.readerSessionId == right.readerSessionId &&
      left.generation == right.generation
  }

  private func documentsReferToSameObservation(
    _ left: FlinkDocumentRefRecord?,
    _ right: FlinkDocumentRefRecord
  ) -> Bool {
    guard let left else {
      return false
    }
    return left.fileId == right.fileId && left.revision == right.revision
  }
}

private extension NSLock {
  func withLock<Result>(_ body: () -> Result) -> Result {
    lock()
    defer { unlock() }
    return body()
  }
}
