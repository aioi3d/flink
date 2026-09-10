import Foundation

/// Limits shared by the face capture path and its static/native tests.
internal enum FlinkFaceLimits {
  static let sampleCapacity = 128
  static let heartbeatTimeoutMs = 2_000.0
  static let watchdogIntervalMs = 250.0
  static let debugFrameIntervalMs = 1_000.0 / 30.0
}
