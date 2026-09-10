import ExpoModulesCore
import Foundation
import UIKit

public final class FlinkNativeModule: Module {
  private static let lifecycleLock = NSLock()
  private static var activeLifecycleId: UUID?

  private let files = FlinkFilesRuntime.shared
  private let face = FaceSessionCoordinator.shared
  private let broker = FlinkReaderContextBroker.shared
  private let lifecycleState = FlinkNativeModuleLifecycleState()

  public func definition() -> ModuleDefinition {
    let lifecycleState = self.lifecycleState

    Name("FlinkNative")

    Constant("nativeApiVersion") {
      FlinkNativeBuildInfo.nativeApiVersion
    }
    Constant("nativeRuntimeVersion") {
      FlinkNativeBuildInfo.nativeRuntimeVersion
    }
    Constant("nativeRuntimeSignature") {
      FlinkNativeBuildInfo.nativeRuntimeSignature
    }

    Events(
      "onLibraryInvalidated",
      "onImportProgress",
      "onDocumentInvalidated"
    )

    OnCreate { [weak self, lifecycleState] in
      guard let self else { return }
      let applicationIsActive = Self.applicationIsActive()
      Self.withLifecycleLock {
        if let activeLifecycleId = Self.activeLifecycleId,
           activeLifecycleId != lifecycleState.id {
          FaceSessionCoordinator.shared.shutdownForModuleDestroy()
          FlinkReaderContextBroker.shared.reset()
        }
        lifecycleState.filesGeneration = installFilesEventSink()
        Self.activeLifecycleId = lifecycleState.id
        // Do not enqueue this behind module destruction: a delayed OnCreate
        // task could otherwise reactivate the process-wide broker after reload.
        broker.setApplicationActive(applicationIsActive)
      }
    }

    OnAppBecomesActive { [lifecycleState] in
      Self.withLifecycleLock {
        guard Self.activeLifecycleId == lifecycleState.id else { return }
        FlinkReaderContextBroker.shared.setApplicationActive(true)
      }
    }

    OnAppEntersBackground { [lifecycleState] in
      Self.withLifecycleLock {
        guard Self.activeLifecycleId == lifecycleState.id else { return }
        FlinkReaderContextBroker.shared.setApplicationActive(false)
      }
    }

    OnAppContextDestroys { [lifecycleState] in
      // Keep the process-wide runtime alive until asynchronous teardown has
      // actually finished; the Module instance may be released immediately
      // after this callback during a JS reload.
      let files = FlinkFilesRuntime.shared
      let generation: UInt64? = Self.withLifecycleLock {
        guard let generation = lifecycleState.filesGeneration else {
          return nil
        }
        lifecycleState.filesGeneration = nil
        let clearedActiveRuntime = files.clearEventSink(
          expectedGeneration: generation
        )
        if clearedActiveRuntime, Self.activeLifecycleId == lifecycleState.id {
          Self.activeLifecycleId = nil
          FaceSessionCoordinator.shared.shutdownForModuleDestroy()
          FlinkReaderContextBroker.shared.reset()
        }
        return generation
      }
      guard let generation else { return }
      Task {
        await files.shutdownForModuleDestroy(expectedGeneration: generation)
      }
    }

    AsyncFunction("getRuntimeInfo") { () -> [String: Any] in
      FlinkNativeBuildInfo.dictionary
    }

    AsyncFunction("initializeLibrary") { [weak self] () async throws -> Void in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "initializeLibrary")
      }
      try await files.initializeLibrary()
    }
    AsyncFunction("scanLibrary") { [weak self] () async throws -> [String: Any] in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "scanLibrary")
      }
      return try await files.scanLibrary()
    }
    AsyncFunction("presentImportPicker") {
      [weak self] (importId: String) async throws -> [String: Any] in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "presentImportPicker")
      }
      return try await files.presentImportPicker(importId: importId)
    }
    AsyncFunction("cancelImport") { [weak self] (importId: String) async throws -> Void in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "cancelImport")
      }
      try await files.cancelImport(importId: importId)
    }
    AsyncFunction("renameDocument") {
      [weak self] (document: FlinkDocumentRefRecord, newBaseName: String) async throws -> [String: Any] in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "renameDocument")
      }
      return try await files.renameDocument(document, newBaseName: newBaseName)
    }
    AsyncFunction("deleteDocument") {
      [weak self] (document: FlinkDocumentRefRecord) async throws -> Void in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "deleteDocument")
      }
      try await files.deleteDocument(document)
    }
    AsyncFunction("requestThumbnail") {
      [weak self] (document: FlinkDocumentRefRecord, requestId: String) async throws -> [String: Any] in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "requestThumbnail")
      }
      return try await files.requestThumbnail(document, requestId: requestId)
    }
    AsyncFunction("cancelThumbnail") {
      [weak self] (requestId: String) async throws -> Void in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "cancelThumbnail")
      }
      try await files.cancelThumbnail(requestId: requestId)
    }

    AsyncFunction("getCapabilities") { [weak self] () throws -> [String: Any] in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "getCapabilities")
      }
      return face.getCapabilities()
    }
    AsyncFunction("requestCameraPermission") { [weak self] () async throws -> String in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "requestCameraPermission")
      }
      return await face.requestCameraPermission()
    }
    AsyncFunction("startTracking") {
      [weak self] (context: FlinkInputContextRecord) throws -> [String: Any] in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "startTracking")
      }
      return try face.startTracking(context: context)
    }
    AsyncFunction("stopTracking") {
      [weak self] (context: FlinkInputContextRecord, reason: String) throws -> Void in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "stopTracking")
      }
      try face.stopTracking(context: context, reason: reason)
    }
    AsyncFunction("resetInput") {
      [weak self] (context: FlinkInputContextRecord) throws -> [String: Any] in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "resetInput")
      }
      return try face.resetInput(context: context)
    }
    AsyncFunction("drainSamples") {
      [weak self] (trackingEpoch: String) throws -> [String: Any] in
      guard let self else {
        throw FlinkNativeLifecycleException(operation: "drainSamples")
      }
      return try face.drainSamples(trackingEpoch: trackingEpoch)
    }

    View(FlinkPDFView.self) {
      Events(
        "onViewReady",
        "onReaderStateChanged",
        "onPageChanged",
        "onReaderError"
      )

      AsyncFunction("openDocument") {
        (view: FlinkPDFView, input: FlinkOpenDocumentInputRecord) async throws -> [String: Any] in
        try await view.openDocument(input)
      }
      AsyncFunction("navigate") {
        (view: FlinkPDFView, request: FlinkNavigateRequestRecord) async throws -> [String: Any] in
        try await view.navigate(request)
      }
      AsyncFunction("closeDocument") {
        (view: FlinkPDFView, readerSessionId: String) async -> Void in
        await view.closeDocument(readerSessionId)
      }
    }

    View(FlinkFaceDebugView.self) {
      ViewName("FlinkFaceDebugView")
      Prop("visible") { (view: FlinkFaceDebugView, visible: Bool) in
        view.setVisible(visible)
      }
    }
  }

  @discardableResult
  private func installFilesEventSink() -> UInt64 {
    files.setEventSink(
      FlinkFilesEventSink(
        libraryInvalidated: { [weak self] reason, indexRevision in
          let event: [String: Any] = [
            "reason": reason,
            "indexRevision": indexRevision ?? NSNull()
          ]
          DispatchQueue.main.async { [weak self] in
            self?.sendEvent("onLibraryInvalidated", event)
          }
        },
        importProgress: { [weak self] progress in
          DispatchQueue.main.async { [weak self] in
            self?.sendEvent("onImportProgress", progress)
          }
        },
        documentInvalidated: { [weak self] document, reason in
          var record = FlinkDocumentRefRecord()
          record.fileId = document.fileId
          record.revision = document.revision
          self?.broker.invalidateDocument(record)
          let event: [String: Any] = [
            "document": document.dictionary,
            "reason": reason
          ]
          DispatchQueue.main.async { [weak self] in
            self?.sendEvent("onDocumentInvalidated", event)
          }
        }
      )
    )
  }

  private static func applicationIsActive() -> Bool {
    if Thread.isMainThread {
      return UIApplication.shared.applicationState == .active
    }
    return DispatchQueue.main.sync {
      UIApplication.shared.applicationState == .active
    }
  }

  private static func withLifecycleLock<Result>(_ body: () -> Result) -> Result {
    lifecycleLock.lock()
    defer { lifecycleLock.unlock() }
    return body()
  }
}

private final class FlinkNativeModuleLifecycleState {
  let id = UUID()
  var filesGeneration: UInt64?
}

internal final class FlinkNativeLifecycleException: Exception {
  private let operation: String

  init(operation: String) {
    self.operation = operation
    super.init()
  }

  override var code: String {
    "E_NATIVE_RUNTIME_MISMATCH"
  }

  override var reason: String {
    "operation=\(operation);diagnostic=module-destroyed"
  }
}
