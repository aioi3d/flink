import ExpoModulesCore
import Foundation

internal struct FlinkFaceInputContext: Equatable {
  let jsRuntimeId: String
  let readerSessionId: String
  let generation: String

  init(record: FlinkInputContextRecord) throws {
    guard FlinkIdentifier.isValid(record.jsRuntimeId),
          FlinkIdentifier.isValid(record.readerSessionId),
          FlinkIdentifier.isValid(record.generation) else {
      throw FlinkFaceException(
        code: "E_TRACKING_STOPPED",
        reason: "The reader input context is invalid."
      )
    }

    jsRuntimeId = record.jsRuntimeId
    readerSessionId = record.readerSessionId
    generation = record.generation
  }

  var dictionary: [String: Any] {
    [
      "jsRuntimeId": jsRuntimeId,
      "readerSessionId": readerSessionId,
      "generation": generation
    ]
  }
}

internal struct FlinkFaceSample {
  let seq: Int
  let nativeMs: Double
  let frameTimestamp: Double
  let trackingEpoch: String
  let context: FlinkFaceInputContext
  let faceId: String?
  let tracked: Bool
  let left: Double?
  let right: Double?
  let jawOpen: Double?

  var dictionary: [String: Any] {
    [
      "seq": seq,
      "nativeMs": nativeMs,
      "frameTimestamp": frameTimestamp,
      "trackingEpoch": trackingEpoch,
      "context": context.dictionary,
      "faceId": faceId as Any? ?? NSNull(),
      "tracked": tracked,
      "left": left as Any? ?? NSNull(),
      "right": right as Any? ?? NSNull(),
      "jawOpen": jawOpen as Any? ?? NSNull()
    ]
  }
}

/// A pull-only buffer. After overflow it drops every sample until the consumer
/// observes `overflowed`, so no part of an old blink can be replayed later.
internal struct FlinkFaceSampleRingBuffer {
  private(set) var overflowed = false
  private var storage: [FlinkFaceSample] = []

  init() {
    storage.reserveCapacity(FlinkFaceLimits.sampleCapacity)
  }

  mutating func append(_ sample: FlinkFaceSample) {
    guard !overflowed else {
      return
    }
    guard storage.count < FlinkFaceLimits.sampleCapacity else {
      storage.removeAll(keepingCapacity: true)
      overflowed = true
      return
    }
    storage.append(sample)
  }

  mutating func drain() -> (samples: [FlinkFaceSample], overflowed: Bool) {
    let result: (samples: [FlinkFaceSample], overflowed: Bool) = (
      overflowed ? [] : storage,
      overflowed
    )
    storage.removeAll(keepingCapacity: true)
    overflowed = false
    return result
  }

  mutating func reset() {
    storage.removeAll(keepingCapacity: true)
    overflowed = false
  }
}

internal final class FlinkFaceException: Exception {
  private let errorCode: String
  private let errorReason: String

  init(code: String, reason: String) {
    errorCode = code
    errorReason = reason
    super.init()
  }

  override var code: String {
    errorCode
  }

  override var reason: String {
    errorReason
  }
}

internal enum FlinkFaceStopCause {
  case requested
  case inactive
  case heartbeatTimeout
  case interrupted
  case sessionFailure
  case thermalCritical
  case moduleDestroyed

  var errorCode: String {
    switch self {
    case .interrupted, .sessionFailure:
      return "E_AR_INTERRUPTED"
    case .requested, .inactive, .heartbeatTimeout, .thermalCritical, .moduleDestroyed:
      return "E_TRACKING_STOPPED"
    }
  }

  var errorReason: String {
    switch self {
    case .requested:
      return "Face tracking was stopped by the reader lifecycle."
    case .inactive:
      return "Face tracking stopped because the app is inactive."
    case .heartbeatTimeout:
      return "Face tracking stopped because sample draining timed out."
    case .interrupted:
      return "The AR face tracking session was interrupted."
    case .sessionFailure:
      return "The AR face tracking session failed."
    case .thermalCritical:
      return "Face tracking stopped because the device is in a critical thermal state."
    case .moduleDestroyed:
      return "Face tracking stopped because the native module was destroyed."
    }
  }
}
