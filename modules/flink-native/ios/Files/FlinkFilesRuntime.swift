import Foundation
import UIKit

/// The single Files entry point used by the Expo module and the PDF view.
/// Every public bridge operation validates opaque IDs before doing file I/O.
internal final class FlinkFilesRuntime: @unchecked Sendable {
  internal static let shared = FlinkFilesRuntime()

  internal let libraryService = FlinkLibraryFileService()
  private let thumbnailService = FlinkThumbnailService()
  private let lock = NSLock()
  private let invalidationQueue = DispatchQueue(label: "com.aioi.flink.file-events")
  private var eventSink: FlinkFilesEventSink?
  private var lifecycleGeneration: UInt64 = 0
  private var activeLifecycleGeneration: UInt64?
  private var pendingShutdownGenerations = [UInt64]()
  private var libraryPresenter: FlinkLibraryPresenter?
  private var libraryPresenterGeneration: UInt64?
  private var pendingLibraryInvalidation: DispatchWorkItem?
  private var pendingLibraryInvalidationGeneration: UInt64?
  private var configuredMutationHandler = false
  private var activeReaderLeases = [UUID: UInt64]()
  private var ownFileMutations = [UUID: UInt64]()
  private var suppressPresenterUntilNanoseconds: UInt64 = 0

  private init() {}

  internal var currentEventSink: FlinkFilesEventSink? {
    lock.flinkWithLock { eventSink }
  }

  @discardableResult
  internal func setEventSink(_ sink: FlinkFilesEventSink?) -> UInt64 {
    lock.flinkWithLock {
      if let sink {
        lifecycleGeneration &+= 1
        activeLifecycleGeneration = lifecycleGeneration
        eventSink = sink
        return lifecycleGeneration
      }
      let generation = activeLifecycleGeneration ?? lifecycleGeneration
      _ = retireEventSinkLocked(expectedGeneration: generation)
      return generation
    }
  }

  /// Retires only the caller's JS context. A delayed old OnDestroy cannot clear
  /// the event sink installed by a newer OnCreate.
  @discardableResult
  internal func clearEventSink(expectedGeneration: UInt64) -> Bool {
    lock.flinkWithLock {
      retireEventSinkLocked(expectedGeneration: expectedGeneration)
    }
  }

  internal func initializeLibrary() async throws {
    let generation = currentLifecycleGeneration
    try await initializeLibrary(runtimeGeneration: generation)
  }

  private func initializeLibrary(runtimeGeneration: UInt64) async throws {
    await configureMutationHandlerIfNeeded()
    try await libraryService.initializeLibrary()
    let paths = try await libraryService.storagePaths()
    try ensureLibraryPresenter(
      libraryURL: paths.library,
      runtimeGeneration: runtimeGeneration
    )
  }

  internal func scanLibrary() async throws -> [String: Any] {
    let generation = currentLifecycleGeneration
    try await initializeLibrary(runtimeGeneration: generation)
    let snapshot = try await libraryService.scanLibrary()
    try assertLifecycleGenerationActive(generation, operation: "scanLibrary")
    return snapshot.dictionary
  }

  internal func presentImportPicker(importId: String) async throws -> [String: Any] {
    let context = lock.flinkWithLock {
      (generation: lifecycleGeneration, eventSink: eventSink)
    }
    try await initializeLibrary(runtimeGeneration: context.generation)
    let presenter = try await MainActor.run {
      try FlinkPresentationViewController.top()
    }
    try assertLifecycleGenerationActive(
      context.generation,
      operation: "presentImportPicker"
    )
    return try await FlinkImportCoordinator.shared.present(
      importId: importId,
      presentingViewController: presenter,
      libraryService: libraryService,
      eventSink: context.eventSink,
      runtimeGeneration: context.generation,
      isRuntimeGenerationActive: { [weak self] in
        self?.isLifecycleGenerationActive(context.generation) ?? false
      }
    )
  }

  internal func cancelImport(importId: String) async throws {
    guard FlinkIdentifier.isValid(importId) else {
      throw FlinkFilesException(.invalidArgument, operation: "cancelImport")
    }
    await FlinkImportCoordinator.shared.cancel(importId: importId)
  }

  internal func renameDocument(
    _ document: FlinkDocumentRefRecord,
    newBaseName: String
  ) async throws -> [String: Any] {
    let generation = currentLifecycleGeneration
    try await initializeLibrary(runtimeGeneration: generation)
    let mutationId = beginOwnFileMutation(runtimeGeneration: generation)
    defer { endOwnFileMutation(mutationId) }
    let renamed = try await libraryService.renameDocument(
      document,
      newBaseName: newBaseName
    )
    return renamed.dictionary
  }

  internal func deleteDocument(_ document: FlinkDocumentRefRecord) async throws {
    let generation = currentLifecycleGeneration
    try await initializeLibrary(runtimeGeneration: generation)
    let mutationId = beginOwnFileMutation(runtimeGeneration: generation)
    defer { endOwnFileMutation(mutationId) }
    try await libraryService.deleteDocument(document)
  }

  internal func requestThumbnail(
    _ document: FlinkDocumentRefRecord,
    requestId: String
  ) async throws -> [String: Any] {
    let generation = currentLifecycleGeneration
    try await initializeLibrary(runtimeGeneration: generation)
    let result = try await thumbnailService.requestThumbnail(
      document: document,
      requestId: requestId,
      libraryService: libraryService,
      runtimeGeneration: generation,
      isRuntimeGenerationActive: { [weak self] in
        self?.isLifecycleGenerationActive(generation) ?? false
      }
    )
    try assertLifecycleGenerationActive(generation, operation: "requestThumbnail")
    if let statusValue = result["status"] as? String,
       let status = FlinkLibraryEntryStatus(rawValue: statusValue),
       let reference = try? FlinkDocumentReference(document) {
      await libraryService.recordValidationStatus(reference, status: status)
    }
    return result
  }

  internal func cancelThumbnail(requestId: String) async throws {
    guard FlinkIdentifier.isValid(requestId) else {
      throw FlinkFilesException(.invalidArgument, operation: "cancelThumbnail")
    }
    thumbnailService.cancel(requestId: requestId)
  }

  internal func shutdownForModuleDestroy() async {
    let pendingGeneration: UInt64? = lock.flinkWithLock {
      pendingShutdownGenerations.isEmpty
        ? nil
        : pendingShutdownGenerations.removeFirst()
    }
    guard let generation = pendingGeneration else {
      return
    }
    await shutdownRuntimeGeneration(generation)
  }

  internal func shutdownForModuleDestroy(expectedGeneration: UInt64) async {
    let latestGeneration = lock.flinkWithLock { lifecycleGeneration }
    guard expectedGeneration <= latestGeneration else {
      return
    }
    _ = clearEventSink(expectedGeneration: expectedGeneration)
    lock.flinkWithLock {
      pendingShutdownGenerations.removeAll { $0 == expectedGeneration }
    }
    await shutdownRuntimeGeneration(expectedGeneration)
  }

  private func shutdownRuntimeGeneration(_ generation: UInt64) async {
    await withCheckedContinuation { continuation in
      invalidationQueue.async { [weak self] in
        if let self {
          self.lock.flinkWithLock {
            guard self.pendingLibraryInvalidationGeneration == generation else { return }
            self.pendingLibraryInvalidation?.cancel()
            self.pendingLibraryInvalidation = nil
            self.pendingLibraryInvalidationGeneration = nil
          }
        }
        continuation.resume()
      }
    }
    let cleanup = lock.flinkWithLock {
      let presenter: FlinkLibraryPresenter?
      if libraryPresenterGeneration == generation {
        presenter = libraryPresenter
        libraryPresenter = nil
        libraryPresenterGeneration = nil
      } else {
        presenter = nil
      }
      activeReaderLeases = activeReaderLeases.filter { $0.value != generation }
      ownFileMutations = ownFileMutations.filter { $0.value != generation }
      if ownFileMutations.isEmpty {
        suppressPresenterUntilNanoseconds = 0
      }
      thumbnailService.setReaderActive(!activeReaderLeases.isEmpty)
      return presenter
    }
    cleanup?.close()
    thumbnailService.cancelAll(runtimeGeneration: generation)
    await FlinkImportCoordinator.shared.shutdownForRuntimeDestroy(
      runtimeGeneration: generation
    )
  }

  internal func resolveDocument(
    _ document: FlinkDocumentRefRecord,
    operation: String
  ) async throws -> FlinkResolvedDocument {
    let generation = currentLifecycleGeneration
    try await initializeLibrary(runtimeGeneration: generation)
    let resolved = try await libraryService.resolveDocument(document, operation: operation)
    try assertLifecycleGenerationActive(generation, operation: operation)
    return resolved.associated(withRuntimeGeneration: generation)
  }

  internal func makeActiveDocumentLease(
    for resolved: FlinkResolvedDocument,
    onInvalidated: @escaping @Sendable (FlinkDocumentInvalidationReason) -> Void,
    onRelinquishToWriter: (@Sendable (
      _ detached: @escaping @Sendable () -> Void
    ) -> Void)?
  ) throws -> FlinkActiveDocumentLease {
    let leaseId = UUID()
    return try lock.flinkWithLock {
      guard let generation = resolved.runtimeGeneration,
            activeLifecycleGeneration == generation else {
        throw FlinkFilesException(
          .nativeRuntimeMismatch,
          operation: "makeActiveDocumentLease"
        )
      }
      let originatingEventSink = eventSink
      activeReaderLeases[leaseId] = generation
      thumbnailService.setReaderActive(true)
      return FlinkActiveDocumentLease(
        document: resolved.reference,
        url: resolved.url,
        onInvalidated: { [weak self] reason in
          onInvalidated(reason)
          let eventReason = reason == .missing ? "missing" : "changed"
          originatingEventSink?.documentInvalidated(resolved.reference, eventReason)
          self?.scheduleLibraryInvalidation(changedURL: resolved.url)
        },
        onRelinquishToWriter: onRelinquishToWriter,
        onClose: { [weak self] in
          self?.readerLeaseDidClose(leaseId)
        }
      )
    }
  }

  @discardableResult
  internal func beginOwnFileMutation(runtimeGeneration: UInt64? = nil) -> UUID {
    let mutationId = UUID()
    lock.flinkWithLock {
      ownFileMutations[mutationId] = runtimeGeneration ?? lifecycleGeneration
    }
    return mutationId
  }

  internal func endOwnFileMutation(_ mutationId: UUID) {
    let now = DispatchTime.now().uptimeNanoseconds
    lock.flinkWithLock {
      guard ownFileMutations.removeValue(forKey: mutationId) != nil else { return }
      suppressPresenterUntilNanoseconds = max(
        suppressPresenterUntilNanoseconds,
        now &+ 750_000_000
      )
    }
  }

  private func configureMutationHandlerIfNeeded() async {
    let shouldConfigure = lock.flinkWithLock {
      guard !configuredMutationHandler else { return false }
      configuredMutationHandler = true
      return true
    }
    guard shouldConfigure else { return }
    await libraryService.setMutationHandler { [weak self] document, reason in
      guard let self else { return }
      thumbnailService.invalidateAll()
      currentEventSink?.documentInvalidated(document, reason)
      let libraryReason: String
      switch reason {
      case "renamed":
        libraryReason = "rename"
      case "deleted":
        libraryReason = "delete"
      default:
        libraryReason = "externalChange"
      }
      currentEventSink?.libraryInvalidated(libraryReason, nil)
    }
  }

  private func ensureLibraryPresenter(
    libraryURL: URL,
    runtimeGeneration: UInt64
  ) throws {
    let active = lock.flinkWithLock {
      guard activeLifecycleGeneration == runtimeGeneration else {
        return false
      }
      if libraryPresenter != nil {
        libraryPresenterGeneration = runtimeGeneration
        return true
      }
      let created = FlinkLibraryPresenter(
        libraryURL: libraryURL,
        onChange: { [weak self] url in
          guard let self, !self.shouldSuppressPresenterChange else { return }
          self.scheduleLibraryInvalidation(changedURL: url)
        }
      )
      libraryPresenter = created
      libraryPresenterGeneration = runtimeGeneration
      created.start()
      return true
    }
    guard active else {
      throw FlinkFilesException(
        .nativeRuntimeMismatch,
        operation: "initializeLibrary"
      )
    }
  }

  private func scheduleLibraryInvalidation(changedURL: URL?) {
    libraryService.noteExternalChange(at: changedURL)
    let generation = currentLifecycleGeneration
    invalidationQueue.async { [weak self] in
      guard let self else { return }
      pendingLibraryInvalidation?.cancel()
      let work = DispatchWorkItem { [weak self] in
        guard let self else { return }
        thumbnailService.invalidateAll()
        currentEventSink?.libraryInvalidated("externalChange", nil)
      }
      pendingLibraryInvalidation = work
      pendingLibraryInvalidationGeneration = generation
      invalidationQueue.asyncAfter(deadline: .now() + .milliseconds(500), execute: work)
    }
  }

  private func readerLeaseDidClose(_ leaseId: UUID) {
    lock.flinkWithLock {
      activeReaderLeases.removeValue(forKey: leaseId)
      thumbnailService.setReaderActive(!activeReaderLeases.isEmpty)
    }
  }

  private var shouldSuppressPresenterChange: Bool {
    let now = DispatchTime.now().uptimeNanoseconds
    return lock.flinkWithLock {
      !ownFileMutations.isEmpty || now < suppressPresenterUntilNanoseconds
    }
  }

  private var currentLifecycleGeneration: UInt64 {
    lock.flinkWithLock { lifecycleGeneration }
  }

  private func retireEventSinkLocked(expectedGeneration: UInt64) -> Bool {
    guard expectedGeneration <= lifecycleGeneration else { return false }
    let clearedActiveSink = activeLifecycleGeneration == expectedGeneration
    if clearedActiveSink {
      activeLifecycleGeneration = nil
      eventSink = nil
    }
    if !pendingShutdownGenerations.contains(expectedGeneration) {
      pendingShutdownGenerations.append(expectedGeneration)
    }
    return clearedActiveSink
  }

  private func assertLifecycleGenerationActive(
    _ generation: UInt64,
    operation: String
  ) throws {
    guard isLifecycleGenerationActive(generation) else {
      throw FlinkFilesException(.nativeRuntimeMismatch, operation: operation)
    }
  }

  private func isLifecycleGenerationActive(_ generation: UInt64) -> Bool {
    lock.flinkWithLock {
      activeLifecycleGeneration == generation
    }
  }
}

@MainActor
private enum FlinkPresentationViewController {
  static func top() throws -> UIViewController {
    let scenes = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .filter { $0.activationState == .foregroundActive }
    let windows = scenes.flatMap(\.windows)
    guard let root = windows.first(where: \.isKeyWindow)?.rootViewController
      ?? windows.first(where: { !$0.isHidden })?.rootViewController
    else {
      throw FlinkFilesException(.providerUnavailable, operation: "presentImportPicker")
    }
    return descend(from: root)
  }

  private static func descend(from controller: UIViewController) -> UIViewController {
    if let presented = controller.presentedViewController {
      return descend(from: presented)
    }
    if let navigation = controller as? UINavigationController,
       let visible = navigation.visibleViewController {
      return descend(from: visible)
    }
    if let tabs = controller as? UITabBarController,
       let selected = tabs.selectedViewController {
      return descend(from: selected)
    }
    for child in controller.children where child.viewIfLoaded?.window != nil {
      return descend(from: child)
    }
    return controller
  }
}
