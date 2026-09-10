import ARKit
import AVFoundation
import Foundation
import simd
import UIKit

internal struct FlinkFaceDebugFrame {
  let geometry: ARFaceGeometry
  let cameraRelativeTransform: simd_float4x4
}

internal protocol FlinkFaceDebugSink: AnyObject {
  @MainActor
  func faceCoordinatorDidUpdate(_ frame: FlinkFaceDebugFrame?)
}

/// Owns the app's only running ARSession. Camera frames never leave ARKit and
/// this class stores only a bounded sequence of small numeric records.
internal final class FaceSessionCoordinator: NSObject, ARSessionDelegate {
  static let shared = FaceSessionCoordinator()

  let session = ARSession()

  private let stateQueue = DispatchQueue(label: "com.aioi.flink.face.state")
  private let delegateQueue = DispatchQueue(label: "com.aioi.flink.face.arkit")
  private let stateQueueKey = DispatchSpecificKey<UInt8>()
  private let callbackEpochLock = NSLock()
  private var watchdogTimer: DispatchSourceTimer?
  private var callbackEpoch: String?
  private var callbackWantsDebugFrame = false

  private var activeContext: FlinkFaceInputContext?
  private var trackingEpoch: String?
  private var running = false
  private var sequence = 0
  private var lastTrackedFaceId: String?
  private var lastDrainNativeMs = 0.0
  private var lastDebugNativeMs = -Double.infinity
  private var stopCause: FlinkFaceStopCause = .requested
  private var samples = FlinkFaceSampleRingBuffer()
  private weak var debugSink: FlinkFaceDebugSink?
  private var pendingDebugFrame: FlinkFaceDebugFrame?
  private var debugDeliveryScheduled = false

  private override init() {
    super.init()

    stateQueue.setSpecific(key: stateQueueKey, value: 1)
    session.delegate = self
    session.delegateQueue = delegateQueue

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationWillResignActive(_:)),
      name: UIApplication.willResignActiveNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationDidEnterBackground(_:)),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(thermalStateDidChange(_:)),
      name: ProcessInfo.thermalStateDidChangeNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    watchdogTimer?.cancel()
    session.pause()
  }

  func getCapabilities() -> [String: Any] {
    [
      "faceTrackingSupported": ARFaceTrackingConfiguration.isSupported,
      "cameraAuthorization": Self.cameraAuthorizationString(
        AVCaptureDevice.authorizationStatus(for: .video)
      ),
      "nativeApiVersion": FlinkNativeBuildInfo.nativeApiVersion,
      "nativeRuntimeSignature": FlinkNativeBuildInfo.nativeRuntimeSignature
    ]
  }

  func requestCameraPermission() async -> String {
    let current = AVCaptureDevice.authorizationStatus(for: .video)
    guard ARFaceTrackingConfiguration.isSupported else {
      return Self.cameraAuthorizationString(current)
    }
    guard current == .notDetermined else {
      return Self.cameraAuthorizationString(current)
    }

    return await withCheckedContinuation { continuation in
      AVCaptureDevice.requestAccess(for: .video) { _ in
        continuation.resume(
          returning: Self.cameraAuthorizationString(
            AVCaptureDevice.authorizationStatus(for: .video)
          )
        )
      }
    }
  }

  func startTracking(context record: FlinkInputContextRecord) throws -> [String: Any] {
    guard ARFaceTrackingConfiguration.isSupported else {
      throw FlinkFaceException(
        code: "E_AR_UNSUPPORTED",
        reason: "AR face tracking is not supported on this device."
      )
    }

    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      break
    case .restricted:
      throw FlinkFaceException(
        code: "E_CAMERA_RESTRICTED",
        reason: "Camera access is restricted on this device."
      )
    case .denied, .notDetermined:
      throw FlinkFaceException(
        code: "E_CAMERA_DENIED",
        reason: "Camera access has not been authorized."
      )
    @unknown default:
      throw FlinkFaceException(
        code: "E_CAMERA_RESTRICTED",
        reason: "The camera authorization state is unavailable."
      )
    }

    guard Self.applicationIsActive() else {
      throw FlinkFaceException(
        code: "E_TRACKING_STOPPED",
        reason: "Face tracking cannot start while the app is inactive."
      )
    }

    let context = try FlinkFaceInputContext(record: record)
    return try withStateLock {
      if running {
        guard activeContext == context, let trackingEpoch else {
          throw FlinkFaceException(
            code: "E_TRACKING_STOPPED",
            reason: "A newer reader input context already owns face tracking."
          )
        }
        guard FlinkReaderContextBroker.shared.isTrackingBound(
          context: record,
          trackingEpoch: trackingEpoch
        ) else {
          stopLocked(cause: .requested, brokerContext: record)
          throw FlinkFaceException(
            code: "E_TRACKING_STOPPED",
            reason: "The reader is no longer ready for face tracking."
          )
        }
        return ["trackingEpoch": trackingEpoch]
      }

      let newEpoch = UUID().uuidString.lowercased()
      guard FlinkReaderContextBroker.shared.bindTracking(
        context: record,
        trackingEpoch: newEpoch
      ) else {
        throw FlinkFaceException(
          code: "E_TRACKING_STOPPED",
          reason: "The reader is not ready for face tracking."
        )
      }

      activeContext = context
      trackingEpoch = newEpoch
      running = true
      ensureWatchdogLocked()
      sequence = 0
      lastTrackedFaceId = nil
      lastDrainNativeMs = Self.monotonicMilliseconds()
      lastDebugNativeMs = -Double.infinity
      stopCause = .requested
      samples.reset()
      setCallbackEpoch(newEpoch)

      session.delegate = self
      session.delegateQueue = delegateQueue

      let configuration = ARFaceTrackingConfiguration()
      configuration.maximumNumberOfTrackedFaces = 1
      session.run(configuration, options: [.resetTracking, .removeExistingAnchors])

      return ["trackingEpoch": newEpoch]
    }
  }

  func stopTracking(context record: FlinkInputContextRecord, reason _: String) throws {
    let context = try FlinkFaceInputContext(record: record)
    try withStateLock {
      guard running else {
        return
      }
      guard activeContext == context else {
        throw FlinkFaceException(
          code: "E_TRACKING_STOPPED",
          reason: "A stale reader context cannot stop the active tracking session."
        )
      }
      stopLocked(cause: .requested, brokerContext: record)
    }
  }

  func resetInput(context record: FlinkInputContextRecord) throws -> [String: Any] {
    let context = try FlinkFaceInputContext(record: record)
    return try withStateLock {
      guard running, activeContext == context else {
        throw FlinkFaceException(
          code: "E_TRACKING_STOPPED",
          reason: "The reader input context is no longer active."
        )
      }

      let newEpoch = UUID().uuidString.lowercased()
      guard FlinkReaderContextBroker.shared.bindTracking(
        context: record,
        trackingEpoch: newEpoch
      ) else {
        stopLocked(cause: .requested, brokerContext: record)
        throw FlinkFaceException(
          code: "E_TRACKING_STOPPED",
          reason: "The reader is no longer ready for face tracking."
        )
      }

      trackingEpoch = newEpoch
      sequence = 0
      lastTrackedFaceId = nil
      lastDrainNativeMs = Self.monotonicMilliseconds()
      samples.reset()
      setCallbackEpoch(newEpoch)
      publishDebugFrameLocked(nil, force: true)
      return ["trackingEpoch": newEpoch]
    }
  }

  func drainSamples(trackingEpoch requestedEpoch: String) throws -> [String: Any] {
    guard FlinkIdentifier.isValid(requestedEpoch) else {
      throw FlinkFaceException(
        code: "E_TRACKING_STOPPED",
        reason: "The tracking epoch is invalid."
      )
    }

    try withStateLock {
      guard running,
            let context = activeContext,
            let trackingEpoch,
            trackingEpoch == requestedEpoch else {
        throw FlinkFaceException(code: stopCause.errorCode, reason: stopCause.errorReason)
      }
      let contextRecord = context.record
      guard FlinkReaderContextBroker.shared.isTrackingBound(
        context: contextRecord,
        trackingEpoch: trackingEpoch
      ) else {
        stopLocked(cause: .requested, brokerContext: contextRecord)
        throw FlinkFaceException(
          code: "E_TRACKING_STOPPED",
          reason: "The reader is no longer ready for face tracking."
        )
      }

      let now = Self.monotonicMilliseconds()
      lastDrainNativeMs = now
      let drained = samples.drain()
      return [
        "trackingEpoch": trackingEpoch,
        "nativeNowMs": now,
        "overflowed": drained.overflowed,
        "samples": drained.samples.map(\.dictionary)
      ]
    }
  }

  /// Called from the Expo module destruction hook. This is synchronous so an
  /// old JS runtime cannot leave the camera running during runtime replacement.
  func shutdownForModuleDestroy() {
    withStateLock {
      stopLocked(cause: .moduleDestroyed, brokerContext: nil)
    }
  }

  /// PDF teardown cannot always wait for JavaScript cleanup. Match the reader
  /// owner before stopping so a delayed close from reader A cannot stop reader B.
  func stopForReaderTermination(readerSessionId: String) {
    guard !readerSessionId.isEmpty else {
      return
    }
    withStateLock {
      guard running, activeContext?.readerSessionId == readerSessionId else {
        return
      }
      stopLocked(cause: .requested, brokerContext: nil)
    }
  }

  /// ARSCNView creates a default session; replace it immediately with the one
  /// coordinator session and restore this object as the coefficient delegate.
  @MainActor
  func connectDebugSceneView(_ view: ARSCNView) {
    view.session = session
    session.delegate = self
    session.delegateQueue = delegateQueue
  }

  func attachDebugSink(_ sink: FlinkFaceDebugSink) {
    withStateLock {
      debugSink = sink
      lastDebugNativeMs = -Double.infinity
      setCallbackWantsDebugFrame(true)
    }
  }

  func detachDebugSink(_ sink: FlinkFaceDebugSink) {
    withStateLock {
      guard debugSink === sink else {
        return
      }
      debugSink = nil
      lastDebugNativeMs = -Double.infinity
      pendingDebugFrame = nil
      setCallbackWantsDebugFrame(false)
    }
  }

  // MARK: - ARSessionDelegate

  func session(_ session: ARSession, didUpdate frame: ARFrame) {
    guard session === self.session,
          let callbackState = getCallbackState(),
          frame.timestamp.isFinite else {
      return
    }

    let nativeMs = Self.monotonicMilliseconds()
    let faceAnchor = frame.anchors.first { $0 is ARFaceAnchor } as? ARFaceAnchor
    let tracked = faceAnchor?.isTracked == true
    let faceId = faceAnchor?.identifier.uuidString.lowercased()
    let observation = FlinkFaceObservation(
      callbackEpoch: callbackState.epoch,
      nativeMs: nativeMs,
      frameTimestamp: frame.timestamp,
      faceId: faceId,
      tracked: tracked,
      left: tracked ? Self.validCoefficient(faceAnchor, key: .eyeBlinkLeft) : nil,
      right: tracked ? Self.validCoefficient(faceAnchor, key: .eyeBlinkRight) : nil,
      jawOpen: tracked ? Self.validCoefficient(faceAnchor, key: .jawOpen) : nil,
      debugFrame: tracked && callbackState.wantsDebugFrame
        ? Self.makeDebugFrame(faceAnchor, frame: frame)
        : nil
    )

    stateQueue.async { [weak self] in
      self?.consumeLocked(observation)
    }
  }

  func sessionWasInterrupted(_ session: ARSession) {
    guard session === self.session, let callbackEpoch = getCallbackEpoch() else {
      return
    }
    stateQueue.async { [weak self] in
      guard let self, self.trackingEpoch == callbackEpoch else {
        return
      }
      self.stopLocked(cause: .interrupted, brokerContext: nil)
    }
  }

  func session(_ session: ARSession, didFailWithError _: Error) {
    guard session === self.session, let callbackEpoch = getCallbackEpoch() else {
      return
    }
    stateQueue.async { [weak self] in
      guard let self, self.trackingEpoch == callbackEpoch else {
        return
      }
      self.stopLocked(cause: .sessionFailure, brokerContext: nil)
    }
  }

  // MARK: - Private state

  private func consumeLocked(_ observation: FlinkFaceObservation) {
    guard running,
          let context = activeContext,
          let epoch = trackingEpoch,
          epoch == observation.callbackEpoch else {
      return
    }

    let currentRecord = context.record
    guard FlinkReaderContextBroker.shared.isTrackingBound(
      context: currentRecord,
      trackingEpoch: epoch
    ) else {
      stopLocked(cause: .requested, brokerContext: currentRecord)
      return
    }

    if observation.tracked, let faceId = observation.faceId {
      if let lastTrackedFaceId, lastTrackedFaceId != faceId {
        // The bridge has no autonomous-epoch-change event. Keep the epoch and
        // sequence monotonic so the next drain remains usable, but discard any
        // queued samples from the previous face. The changed `faceId` then
        // resets the TypeScript detector before it can form a mixed candidate.
        samples.reset()
      }
      lastTrackedFaceId = faceId
    }

    sequence += 1
    let timestamp = observation.frameTimestamp

    samples.append(
      FlinkFaceSample(
        seq: sequence,
        nativeMs: observation.nativeMs,
        frameTimestamp: timestamp,
        trackingEpoch: epoch,
        context: context,
        faceId: observation.faceId,
        tracked: observation.tracked,
        left: observation.left,
        right: observation.right,
        jawOpen: observation.jawOpen
      )
    )

    // Keep the raw AR timestamp in every sample so the TypeScript detector can
    // reject duplicate or reversed frames without mixing clock domains.
    publishDebugFrameLocked(
      observation.debugFrame,
      force: false,
      nativeMs: observation.nativeMs
    )
  }

  private func publishDebugFrameLocked(
    _ frame: FlinkFaceDebugFrame?,
    force: Bool,
    nativeMs: Double? = nil
  ) {
    guard let debugSink else {
      return
    }
    let now = nativeMs ?? Self.monotonicMilliseconds()
    guard force || now - lastDebugNativeMs >= FlinkFaceLimits.debugFrameIntervalMs else {
      return
    }
    lastDebugNativeMs = now
    pendingDebugFrame = frame
    guard !debugDeliveryScheduled else {
      return
    }
    debugDeliveryScheduled = true
    DispatchQueue.main.async { [weak self] in
      self?.deliverPendingDebugFrameOnMain()
    }
  }

  @MainActor
  private func deliverPendingDebugFrameOnMain() {
    dispatchPrecondition(condition: .onQueue(.main))
    let delivery: (sink: FlinkFaceDebugSink?, frame: FlinkFaceDebugFrame?) = withStateLock {
      let result = (debugSink, pendingDebugFrame)
      pendingDebugFrame = nil
      debugDeliveryScheduled = false
      return result
    }
    delivery.sink?.faceCoordinatorDidUpdate(delivery.frame)
  }

  private func runWatchdogLocked() {
    guard running else {
      return
    }
    let elapsed = Self.monotonicMilliseconds() - lastDrainNativeMs
    guard elapsed >= FlinkFaceLimits.heartbeatTimeoutMs else {
      return
    }
    stopLocked(cause: .heartbeatTimeout, brokerContext: nil)
  }

  private func ensureWatchdogLocked() {
    guard watchdogTimer == nil else {
      return
    }
    let timer = DispatchSource.makeTimerSource(queue: stateQueue)
    timer.schedule(
      deadline: .now() + .milliseconds(Int(FlinkFaceLimits.watchdogIntervalMs)),
      repeating: .milliseconds(Int(FlinkFaceLimits.watchdogIntervalMs)),
      leeway: .milliseconds(50)
    )
    timer.setEventHandler { [weak self] in
      self?.runWatchdogLocked()
    }
    watchdogTimer = timer
    timer.resume()
  }

  private func stopWatchdogLocked() {
    guard let timer = watchdogTimer else {
      return
    }
    watchdogTimer = nil
    timer.cancel()
  }

  private func stopLocked(
    cause: FlinkFaceStopCause,
    brokerContext explicitRecord: FlinkInputContextRecord?
  ) {
    let contextRecord = explicitRecord ?? activeContext?.record
    if let contextRecord {
      FlinkReaderContextBroker.shared.unbindTracking(context: contextRecord)
    }
    if running {
      session.pause()
    }
    running = false
    stopWatchdogLocked()
    activeContext = nil
    trackingEpoch = nil
    setCallbackEpoch(nil)
    sequence = 0
    lastTrackedFaceId = nil
    lastDrainNativeMs = 0
    stopCause = cause
    samples.reset()
    publishDebugFrameLocked(nil, force: true)
  }

  private func withStateLock<Result>(_ body: () throws -> Result) rethrows -> Result {
    if DispatchQueue.getSpecific(key: stateQueueKey) != nil {
      return try body()
    }
    return try stateQueue.sync(execute: body)
  }

  private func getCallbackEpoch() -> String? {
    callbackEpochLock.lock()
    defer { callbackEpochLock.unlock() }
    return callbackEpoch
  }

  private func getCallbackState() -> (epoch: String, wantsDebugFrame: Bool)? {
    callbackEpochLock.lock()
    defer { callbackEpochLock.unlock() }
    guard let callbackEpoch else {
      return nil
    }
    return (callbackEpoch, callbackWantsDebugFrame)
  }

  private func setCallbackEpoch(_ epoch: String?) {
    callbackEpochLock.lock()
    callbackEpoch = epoch
    callbackEpochLock.unlock()
  }

  private func setCallbackWantsDebugFrame(_ enabled: Bool) {
    callbackEpochLock.lock()
    callbackWantsDebugFrame = enabled
    callbackEpochLock.unlock()
  }

  @objc private func applicationWillResignActive(_: Notification) {
    stateQueue.async { [weak self] in
      self?.stopLocked(cause: .inactive, brokerContext: nil)
    }
  }

  @objc private func applicationDidEnterBackground(_: Notification) {
    stateQueue.async { [weak self] in
      self?.stopLocked(cause: .inactive, brokerContext: nil)
    }
  }

  @objc private func thermalStateDidChange(_: Notification) {
    guard ProcessInfo.processInfo.thermalState == .critical else {
      return
    }
    stateQueue.async { [weak self] in
      self?.stopLocked(cause: .thermalCritical, brokerContext: nil)
    }
  }

  private static func makeDebugFrame(
    _ anchor: ARFaceAnchor?,
    frame: ARFrame
  ) -> FlinkFaceDebugFrame? {
    guard let anchor else {
      return nil
    }
    return FlinkFaceDebugFrame(
      geometry: anchor.geometry,
      cameraRelativeTransform: simd_mul(
        simd_inverse(frame.camera.transform),
        anchor.transform
      )
    )
  }

  private static func validCoefficient(
    _ anchor: ARFaceAnchor?,
    key: ARFaceAnchor.BlendShapeLocation
  ) -> Double? {
    guard let number = anchor?.blendShapes[key] else {
      return nil
    }
    let value = number.doubleValue
    guard value.isFinite, (0.0 ... 1.0).contains(value) else {
      return nil
    }
    return value
  }

  private static func cameraAuthorizationString(_ status: AVAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
      return "notDetermined"
    case .authorized:
      return "authorized"
    case .denied:
      return "denied"
    case .restricted:
      return "restricted"
    @unknown default:
      return "restricted"
    }
  }

  private static func monotonicMilliseconds() -> Double {
    ProcessInfo.processInfo.systemUptime * 1_000.0
  }

  private static func applicationIsActive() -> Bool {
    if Thread.isMainThread {
      return UIApplication.shared.applicationState == .active
    }
    return DispatchQueue.main.sync {
      UIApplication.shared.applicationState == .active
    }
  }
}

private struct FlinkFaceObservation {
  let callbackEpoch: String
  let nativeMs: Double
  let frameTimestamp: Double
  let faceId: String?
  let tracked: Bool
  let left: Double?
  let right: Double?
  let jawOpen: Double?
  let debugFrame: FlinkFaceDebugFrame?
}

private extension FlinkFaceInputContext {
  var record: FlinkInputContextRecord {
    var record = FlinkInputContextRecord()
    record.jsRuntimeId = jsRuntimeId
    record.readerSessionId = readerSessionId
    record.generation = generation
    return record
  }
}
