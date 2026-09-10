import Darwin
import Foundation
import UIKit
import UniformTypeIdentifiers

internal struct FlinkImportProgress: Sendable {
  let importId: String
  let fileName: String
  let fileIndex: Int
  let totalFiles: Int
  let stage: String
  let copiedBytes: Int64
  let totalBytes: Int64?

  var dictionary: [String: Any] {
    [
      "importId": importId,
      "fileName": fileName,
      "fileIndex": fileIndex,
      "totalFiles": totalFiles,
      "stage": stage,
      "copiedBytes": Double(copiedBytes),
      "totalBytes": totalBytes.map(Double.init) ?? NSNull(),
    ]
  }
}

private struct FlinkImportFailure: Sendable {
  let name: String
  let code: String

  var dictionary: [String: Any] {
    ["name": name, "code": code]
  }
}

private struct FlinkImportWorkerResult: Sendable {
  let committedRelativePaths: [String]
  let failures: [FlinkImportFailure]
  let cancelled: Bool
}

private struct FlinkImportCancelled: Error {}

internal final class FlinkImportCancellationToken: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false

  internal func cancel() {
    lock.flinkWithLock {
      cancelled = true
    }
  }

  internal var isCancelled: Bool {
    lock.flinkWithLock { cancelled }
  }

  internal func check() throws {
    if isCancelled {
      throw FlinkImportCancelled()
    }
  }
}

private final class FlinkImportProgressEmitter: @unchecked Sendable {
  private let lock = NSLock()
  private let sink: @Sendable ([String: Any]) -> Void
  private var lastEmissionNanoseconds: UInt64 = 0

  init(sink: @escaping @Sendable ([String: Any]) -> Void) {
    self.sink = sink
  }

  func emit(_ progress: FlinkImportProgress, force: Bool = false) {
    let now = DispatchTime.now().uptimeNanoseconds
    let shouldEmit = lock.flinkWithLock {
      guard force || lastEmissionNanoseconds == 0
        || now &- lastEmissionNanoseconds >= 100_000_000
      else {
        return false
      }
      lastEmissionNanoseconds = now
      return true
    }
    if shouldEmit {
      sink(progress.dictionary)
    }
  }
}

private final class FlinkImportWorker: @unchecked Sendable {
  private let queue = DispatchQueue(label: "com.aioi.flink.import", qos: .userInitiated)
  private let fileManager: FileManager

  init(fileManager: FileManager = .default) {
    self.fileManager = fileManager
  }

  func process(
    urls: [URL],
    importId: String,
    runtimeGeneration: UInt64,
    paths: FlinkStoragePaths,
    cancellation: FlinkImportCancellationToken,
    progress: FlinkImportProgressEmitter
  ) async -> FlinkImportWorkerResult {
    await withCheckedContinuation { continuation in
      queue.async {
        continuation.resume(returning: self.processOnQueue(
          urls: urls,
          importId: importId,
          runtimeGeneration: runtimeGeneration,
          paths: paths,
          cancellation: cancellation,
          progress: progress
        ))
      }
    }
  }

  private func processOnQueue(
    urls: [URL],
    importId: String,
    runtimeGeneration: UInt64,
    paths: FlinkStoragePaths,
    cancellation: FlinkImportCancellationToken,
    progress: FlinkImportProgressEmitter
  ) -> FlinkImportWorkerResult {
    var committed = [String]()
    var failures = [FlinkImportFailure]()
    var cancelled = false

    for (offset, sourceURL) in urls.enumerated() {
      if cancellation.isCancelled {
        cancelled = true
        break
      }
      let displayName = sourceURL.lastPathComponent.isEmpty
        ? "PDF"
        : sourceURL.lastPathComponent
      do {
        let relativePath = try importOne(
          sourceURL: sourceURL,
          displayName: displayName,
          fileIndex: offset,
          totalFiles: urls.count,
          importId: importId,
          runtimeGeneration: runtimeGeneration,
          paths: paths,
          cancellation: cancellation,
          progress: progress
        )
        committed.append(relativePath)
      } catch is FlinkImportCancelled {
        cancelled = true
        break
      } catch let error as FlinkFilesException {
        failures.append(FlinkImportFailure(name: displayName, code: error.code))
      } catch {
        let mapped = FlinkFilesException.wrapping(
          error,
          operation: "importDocument",
          fallback: .providerUnavailable
        )
        failures.append(FlinkImportFailure(name: displayName, code: mapped.code))
      }
    }

    return FlinkImportWorkerResult(
      committedRelativePaths: committed,
      failures: failures,
      cancelled: cancelled
    )
  }

  private func importOne(
    sourceURL: URL,
    displayName: String,
    fileIndex: Int,
    totalFiles: Int,
    importId: String,
    runtimeGeneration: UInt64,
    paths: FlinkStoragePaths,
    cancellation: FlinkImportCancellationToken,
    progress: FlinkImportProgressEmitter
  ) throws -> String {
    guard sourceURL.isFileURL,
          sourceURL.pathExtension.caseInsensitiveCompare("pdf") == .orderedSame
    else {
      throw FlinkFilesException(.notPDF, operation: "importDocument")
    }
    try cancellation.check()

    progress.emit(FlinkImportProgress(
      importId: importId,
      fileName: displayName,
      fileIndex: fileIndex,
      totalFiles: totalFiles,
      stage: "waitingForProvider",
      copiedBytes: 0,
      totalBytes: nil
    ))

    let isInsideSandbox = sourceURL.standardizedFileURL.pathComponents.starts(
      with: URL(fileURLWithPath: NSHomeDirectory(), isDirectory: true)
        .standardizedFileURL.pathComponents
    )
    let acquiredSecurityScope = isInsideSandbox
      ? false
      : sourceURL.startAccessingSecurityScopedResource()
    if !isInsideSandbox && !acquiredSecurityScope {
      throw FlinkFilesException(.importPermission, operation: "importDocument")
    }
    defer {
      if acquiredSecurityScope {
        sourceURL.stopAccessingSecurityScopedResource()
      }
    }

    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordinationError: NSError?
    var accessorError: Error?
    var committedRelativePath: String?
    coordinator.coordinate(
      readingItemAt: sourceURL,
      options: .withoutChanges,
      error: &coordinationError
    ) { coordinatedURL in
      do {
        try cancellation.check()
        committedRelativePath = try self.copyCoordinatedSource(
          coordinatedURL,
          originalName: displayName,
          fileIndex: fileIndex,
          totalFiles: totalFiles,
          importId: importId,
          runtimeGeneration: runtimeGeneration,
          paths: paths,
          cancellation: cancellation,
          progress: progress
        )
      } catch {
        accessorError = error
      }
    }
    if let coordinationError {
      throw FlinkFilesException.wrapping(
        coordinationError,
        operation: "coordinateImportRead",
        fallback: .providerUnavailable
      )
    }
    if let accessorError {
      throw accessorError
    }
    guard let committedRelativePath else {
      throw FlinkFilesException(.providerUnavailable, operation: "importDocument")
    }
    return committedRelativePath
  }

  private func copyCoordinatedSource(
    _ sourceURL: URL,
    originalName: String,
    fileIndex: Int,
    totalFiles: Int,
    importId: String,
    runtimeGeneration: UInt64,
    paths: FlinkStoragePaths,
    cancellation: FlinkImportCancellationToken,
    progress: FlinkImportProgressEmitter
  ) throws -> String {
    let values: URLResourceValues
    do {
      values = try sourceURL.resourceValues(forKeys: [
        .isRegularFileKey,
        .isDirectoryKey,
        .isSymbolicLinkKey,
        .fileSizeKey,
      ])
    } catch {
      throw FlinkFilesException.wrapping(
        error,
        operation: "readImportMetadata",
        fallback: .providerUnavailable
      )
    }
    guard values.isRegularFile == true,
          values.isDirectory != true,
          values.isSymbolicLink != true
    else {
      throw FlinkFilesException(.notPDF, operation: "importDocument")
    }
    let totalBytes = values.fileSize.map(Int64.init)
    if let totalBytes, totalBytes < 0 {
      throw FlinkFilesException(.providerUnavailable, operation: "readImportMetadata")
    }
    try validateAvailableCapacity(requiredBytes: totalBytes, at: paths.importStaging)

    let partial = paths.importStaging
      .appendingPathComponent("\(UUID().uuidString.lowercased()).partial", isDirectory: false)
    guard fileManager.createFile(
      atPath: partial.path,
      contents: nil,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
    ) else {
      throw FlinkFilesException(.libraryUnavailable, operation: "createImportPartial")
    }
    var committed = false
    defer {
      if !committed {
        try? fileManager.removeItem(at: partial)
      }
    }

    let input: FileHandle
    do {
      input = try FileHandle(forReadingFrom: sourceURL)
    } catch {
      throw FlinkFilesException.wrapping(
        error,
        operation: "openImportSource",
        fallback: .providerUnavailable
      )
    }
    let output: FileHandle
    do {
      output = try FileHandle(forWritingTo: partial)
    } catch {
      try? input.close()
      throw FlinkFilesException.wrapping(
        error,
        operation: "openImportPartial",
        fallback: .libraryUnavailable
      )
    }
    defer {
      try? input.close()
      try? output.close()
    }

    do {
      let header = try input.read(upToCount: 1_024) ?? Data()
      guard header.range(of: Data("%PDF-".utf8)) != nil else {
        throw FlinkFilesException(.notPDF, operation: "validateImportHeader")
      }
      try input.seek(toOffset: 0)

      var copiedBytes: Int64 = 0
      while true {
        try cancellation.check()
        let chunk: Data? = try autoreleasepool {
          try input.read(upToCount: 1_048_576)
        }
        guard let chunk, !chunk.isEmpty else {
          break
        }
        try output.write(contentsOf: chunk)
        let (nextCount, overflow) = copiedBytes.addingReportingOverflow(Int64(chunk.count))
        guard !overflow else {
          throw FlinkFilesException(.providerUnavailable, operation: "copyImport")
        }
        copiedBytes = nextCount
        progress.emit(FlinkImportProgress(
          importId: importId,
          fileName: originalName,
          fileIndex: fileIndex,
          totalFiles: totalFiles,
          stage: "copying",
          copiedBytes: copiedBytes,
          totalBytes: totalBytes
        ))
      }
      try output.synchronize()
      try input.close()
      try output.close()
      if let totalBytes, copiedBytes != totalBytes {
        throw FlinkFilesException(.providerUnavailable, operation: "copyImport")
      }
      try cancellation.check()

      progress.emit(FlinkImportProgress(
        importId: importId,
        fileName: originalName,
        fileIndex: fileIndex,
        totalFiles: totalFiles,
        stage: "committing",
        copiedBytes: copiedBytes,
        totalBytes: totalBytes
      ), force: true)
      let mutationId = FlinkFilesRuntime.shared.beginOwnFileMutation(
        runtimeGeneration: runtimeGeneration
      )
      defer { FlinkFilesRuntime.shared.endOwnFileMutation(mutationId) }
      let destination = try commitNoReplace(
        partial: partial,
        originalName: originalName,
        library: paths.library
      )
      committed = true
      return try FlinkPathSafety.relativePath(of: destination, within: paths.library)
    } catch is FlinkImportCancelled {
      throw FlinkImportCancelled()
    } catch let error as FlinkFilesException {
      throw error
    } catch {
      throw FlinkFilesException.wrapping(
        error,
        operation: "copyImport",
        fallback: .providerUnavailable
      )
    }
  }

  private func validateAvailableCapacity(requiredBytes: Int64?, at directory: URL) throws {
    guard let requiredBytes else { return }
    guard let values = try? directory.resourceValues(forKeys: [
      .volumeAvailableCapacityForImportantUsageKey,
    ]) else {
      // Capacity can be unavailable. The streaming write still reports ENOSPC.
      return
    }
    guard let available = values.volumeAvailableCapacityForImportantUsage else {
      return
    }
    let tenPercent = requiredBytes / 10
      + (requiredBytes % 10 == 0 ? 0 : 1)
    let margin = max(Int64(64 * 1_024 * 1_024), tenPercent)
    let (requiredWithMargin, overflow) = requiredBytes.addingReportingOverflow(margin)
    guard !overflow, available >= requiredWithMargin else {
      throw FlinkFilesException(.noSpace, operation: "preflightImportCapacity")
    }
  }

  private func commitNoReplace(
    partial: URL,
    originalName: String,
    library: URL
  ) throws -> URL {
    let baseName = try importBaseName(originalName)
    for suffixNumber in 1...10_000 {
      let suffix = suffixNumber == 1 ? "" : " (\(suffixNumber))"
      guard "\(baseName)\(suffix).pdf".utf8.count <= 255 else {
        throw FlinkFilesException(.nameInvalid, operation: "commitImport")
      }
      let destination = library.appendingPathComponent(
        "\(baseName)\(suffix).pdf",
        isDirectory: false
      )
      var coordinationError: NSError?
      var commitError: Error?
      var committed = false
      NSFileCoordinator(filePresenter: nil).coordinate(
        writingItemAt: destination,
        options: [],
        error: &coordinationError
      ) { coordinatedDestination in
        let result = partial.path.withCString { sourcePath in
          coordinatedDestination.path.withCString { destinationPath in
            renamex_np(sourcePath, destinationPath, UInt32(RENAME_EXCL))
          }
        }
        if result == 0 {
          committed = true
          return
        }
        let capturedErrno = errno
        switch capturedErrno {
        case EEXIST:
          commitError = FlinkFilesException(.nameConflict, operation: "commitImport")
        case ENOSPC, EDQUOT:
          commitError = FlinkFilesException(.noSpace, operation: "commitImport")
        default:
          commitError = FlinkFilesException(
            .libraryUnavailable,
            operation: "commitImport",
            diagnostic: "POSIX:\(capturedErrno)"
          )
        }
      }
      if let coordinationError {
        throw FlinkFilesException.wrapping(
          coordinationError,
          operation: "coordinateImportCommit",
          fallback: .libraryUnavailable
        )
      }
      if committed {
        return destination
      }
      if let error = commitError as? FlinkFilesException,
         error.code == FlinkFileErrorCode.nameConflict.rawValue {
        continue
      }
      if let commitError {
        throw commitError
      }
    }
    throw FlinkFilesException(.nameConflict, operation: "commitImport")
  }

  private func importBaseName(_ originalName: String) throws -> String {
    let baseName = (originalName as NSString).deletingPathExtension
    let trimmed = baseName.trimmingCharacters(in: .whitespacesAndNewlines)
    let containsControl = baseName.unicodeScalars.contains {
      CharacterSet.controlCharacters.contains($0)
    }
    guard !trimmed.isEmpty,
          trimmed != ".",
          trimmed != "..",
          !baseName.hasPrefix("."),
          !baseName.contains("/"),
          !baseName.contains("\\"),
          !containsControl,
          "\(baseName).pdf".utf8.count <= 255
    else {
      throw FlinkFilesException(.nameInvalid, operation: "importDocument")
    }
    return baseName
  }

}

@MainActor
internal final class FlinkImportCoordinator: NSObject,
  UIDocumentPickerDelegate,
  UIAdaptivePresentationControllerDelegate {
  private final class Session {
    let importId: String
    let runtimeGeneration: UInt64
    let libraryService: FlinkLibraryFileService
    let eventSink: FlinkFilesEventSink?
    let cancellation = FlinkImportCancellationToken()
    let continuation: CheckedContinuation<[String: Any], Error>
    var picker: UIDocumentPickerViewController?
    var isSelecting = true
    var completed = false

    init(
      importId: String,
      runtimeGeneration: UInt64,
      libraryService: FlinkLibraryFileService,
      eventSink: FlinkFilesEventSink?,
      continuation: CheckedContinuation<[String: Any], Error>
    ) {
      self.importId = importId
      self.runtimeGeneration = runtimeGeneration
      self.libraryService = libraryService
      self.eventSink = eventSink
      self.continuation = continuation
    }
  }

  internal static let shared = FlinkImportCoordinator()
  private let worker = FlinkImportWorker()
  private var activeSession: Session?
  private var highestRetiredRuntimeGeneration: UInt64?

  private override init() {
    super.init()
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationDidEnterBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
  }

  internal func present(
    importId: String,
    presentingViewController: UIViewController,
    libraryService: FlinkLibraryFileService,
    eventSink: FlinkFilesEventSink?,
    runtimeGeneration: UInt64,
    isRuntimeGenerationActive: @escaping @Sendable () -> Bool
  ) async throws -> [String: Any] {
    guard FlinkIdentifier.isValid(importId) else {
      throw FlinkFilesException(.invalidArgument, operation: "presentImportPicker")
    }
    if let retired = highestRetiredRuntimeGeneration,
       runtimeGeneration <= retired {
      throw FlinkFilesException(
        .nativeRuntimeMismatch,
        operation: "presentImportPicker"
      )
    }
    guard isRuntimeGenerationActive() else {
      throw FlinkFilesException(
        .nativeRuntimeMismatch,
        operation: "presentImportPicker"
      )
    }
    guard activeSession == nil else {
      throw FlinkFilesException(.importBusy, operation: "presentImportPicker")
    }
    let progress = FlinkImportProgressEmitter { value in
      eventSink?.importProgress(value)
    }

    progress.emit(FlinkImportProgress(
      importId: importId,
      fileName: "",
      fileIndex: 0,
      totalFiles: 0,
      stage: "selecting",
      copiedBytes: 0,
      totalBytes: nil
    ), force: true)

    return try await withCheckedThrowingContinuation { continuation in
      let session = Session(
        importId: importId,
        runtimeGeneration: runtimeGeneration,
        libraryService: libraryService,
        eventSink: eventSink,
        continuation: continuation
      )
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: [.pdf],
        asCopy: false
      )
      picker.allowsMultipleSelection = true
      picker.shouldShowFileExtensions = true
      picker.delegate = self
      picker.presentationController?.delegate = self
      session.picker = picker
      activeSession = session
      presentingViewController.present(picker, animated: true) {
        picker.presentationController?.delegate = self
      }
    }
  }

  internal func cancel(importId: String) {
    guard let session = activeSession, session.importId == importId else {
      return
    }
    session.cancellation.cancel()
    if session.isSelecting {
      session.picker?.dismiss(animated: true)
      finish(session, result: cancelledResult(importId: importId))
    }
  }

  internal func shutdownForRuntimeDestroy(runtimeGeneration: UInt64) {
    highestRetiredRuntimeGeneration = max(
      highestRetiredRuntimeGeneration ?? runtimeGeneration,
      runtimeGeneration
    )
    guard let session = activeSession,
          session.runtimeGeneration == runtimeGeneration else { return }
    session.cancellation.cancel()
    session.picker?.dismiss(animated: false)
    finish(session, result: cancelledResult(importId: session.importId))
  }

  internal func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    guard let session = activeSession, session.picker === controller else {
      return
    }
    session.cancellation.cancel()
    finish(session, result: cancelledResult(importId: session.importId))
  }

  internal func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    guard let session = activeSession, session.picker === controller else {
      return
    }
    session.isSelecting = false
    let libraryService = session.libraryService
    let eventSink = session.eventSink
    let progress = FlinkImportProgressEmitter { value in
      eventSink?.importProgress(value)
    }
    Task { [weak self] in
      guard let self else { return }
      do {
        let paths = try await libraryService.storagePaths()
        let workerResult = await worker.process(
          urls: urls,
          importId: session.importId,
          runtimeGeneration: session.runtimeGeneration,
          paths: paths,
          cancellation: session.cancellation,
          progress: progress
        )
        guard activeSession === session, !session.completed else {
          return
        }
        let snapshot = try await libraryService.scanLibrary()
        let committed = Set(workerResult.committedRelativePaths)
        let imported = snapshot.entries
          .filter { committed.contains($0.relativePath) }
          .map { $0.reference.dictionary }
        let importedPaths = Set(snapshot.entries
          .filter { committed.contains($0.relativePath) }
          .map(\.relativePath))
        let disappeared = workerResult.committedRelativePaths
          .filter { !importedPaths.contains($0) }
          .map {
            FlinkImportFailure(
              name: ($0 as NSString).lastPathComponent,
              code: FlinkFileErrorCode.fileMissing.rawValue
            )
          }
        let result: [String: Any] = [
          "importId": session.importId,
          "cancelled": workerResult.cancelled,
          "imported": imported,
          "failures": (workerResult.failures + disappeared).map(\.dictionary),
        ]
        eventSink?.libraryInvalidated("import", snapshot.indexRevision)
        finish(session, result: result)
      } catch {
        finish(session, error: FlinkFilesException.wrapping(
          error,
          operation: "presentImportPicker",
          fallback: .libraryUnavailable
        ))
      }
    }
  }

  internal func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    guard let session = activeSession, session.isSelecting else { return }
    session.cancellation.cancel()
    finish(session, result: cancelledResult(importId: session.importId))
  }

  @objc private func applicationDidEnterBackground() {
    guard let session = activeSession else { return }
    session.cancellation.cancel()
    if session.isSelecting {
      session.picker?.dismiss(animated: false)
      finish(session, result: cancelledResult(importId: session.importId))
    }
  }

  private func cancelledResult(importId: String) -> [String: Any] {
    [
      "importId": importId,
      "cancelled": true,
      "imported": [],
      "failures": [],
    ]
  }

  private func finish(_ session: Session, result: [String: Any]) {
    guard activeSession === session, !session.completed else { return }
    session.completed = true
    activeSession = nil
    session.picker = nil
    session.continuation.resume(returning: result)
  }

  private func finish(_ session: Session, error: Error) {
    guard activeSession === session, !session.completed else { return }
    session.completed = true
    activeSession = nil
    session.picker = nil
    session.continuation.resume(throwing: error)
  }
}
