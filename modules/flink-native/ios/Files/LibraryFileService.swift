import Darwin
import Foundation

internal final class FlinkLibraryFileService: @unchecked Sendable {
  private struct Observation {
    let fileId: String
    let generation: UInt64
    let metadataFingerprint: String
  }

  private struct Candidate {
    let name: String
    let relativePath: String
    let url: URL
    let sizeBytes: Int64
    let modifiedAtUnixMs: Double?
    let resourceIdentity: String?
    let identityKey: String
    let metadataFingerprint: String
  }

  private let fileManager: FileManager
  private let queue = DispatchQueue(label: "com.aioi.flink.files", qos: .userInitiated)
  private let scanStateLock = NSLock()
  private var scanWorkerRunning = false
  private var scanWaiters = [CheckedContinuation<FlinkLibrarySnapshot, Error>]()
  private var paths: FlinkStoragePaths?
  private var didInitialize = false
  private var indexedById: [String: FlinkIndexedDocument] = [:]
  private var observationsByIdentity: [String: Observation] = [:]
  private var forcedRelativePaths = Set<String>()
  private var forceAllOnNextScan = false
  private var indexRevision = "index-\(UUID().uuidString.lowercased())"
  private var mutationHandler: (@Sendable (
    _ document: FlinkDocumentReference,
    _ reason: String
  ) -> Void)?

  internal init(fileManager: FileManager = .default) {
    self.fileManager = fileManager
  }

  internal func setMutationHandler(
    _ handler: (@Sendable (
      _ document: FlinkDocumentReference,
      _ reason: String
    ) -> Void)?
  ) async {
    await performWithoutThrowing {
      self.mutationHandler = handler
    }
  }

  internal func initializeLibrary() async throws {
    try await perform {
      _ = try self.initializeOnQueue()
    }
  }

  internal func storagePaths() async throws -> FlinkStoragePaths {
    try await perform {
      try self.initializeOnQueue()
    }
  }

  internal func scanLibrary() async throws -> FlinkLibrarySnapshot {
    try await withCheckedThrowingContinuation { continuation in
      let shouldStartWorker = scanStateLock.flinkWithLock {
        scanWaiters.append(continuation)
        guard !scanWorkerRunning else { return false }
        scanWorkerRunning = true
        return true
      }
      if shouldStartWorker {
        queue.async {
          self.drainScanRequestsOnQueue()
        }
      }
    }
  }

  internal func resolveDocument(
    _ record: FlinkDocumentRefRecord,
    operation: String
  ) async throws -> FlinkResolvedDocument {
    let reference = try FlinkDocumentReference(record)
    return try await resolveDocument(reference, operation: operation)
  }

  internal func resolveDocument(
    _ reference: FlinkDocumentReference,
    operation: String
  ) async throws -> FlinkResolvedDocument {
    try await perform {
      try self.resolveOnQueue(reference, operation: operation)
    }
  }

  internal func renameDocument(
    _ record: FlinkDocumentRefRecord,
    newBaseName: String
  ) async throws -> FlinkDocumentReference {
    let reference = try FlinkDocumentReference(record)
    do {
      return try await perform {
        try self.renameOnQueue(reference, newBaseName: newBaseName)
      }
    } catch {
      throw FlinkFilesException.wrapping(
        error,
        operation: "renameDocument",
        fallback: .libraryUnavailable
      )
    }
  }

  internal func deleteDocument(_ record: FlinkDocumentRefRecord) async throws {
    let reference = try FlinkDocumentReference(record)
    do {
      try await perform {
        try self.deleteOnQueue(reference)
      }
    } catch {
      throw FlinkFilesException.wrapping(
        error,
        operation: "deleteDocument",
        fallback: .libraryUnavailable
      )
    }
  }

  internal func recordValidationStatus(
    _ reference: FlinkDocumentReference,
    status: FlinkLibraryEntryStatus
  ) async {
    await performWithoutThrowing {
      guard let current = self.indexedById[reference.fileId],
            current.reference == reference,
            current.status != status else {
        return
      }
      self.indexedById[reference.fileId] = FlinkIndexedDocument(
        reference: current.reference,
        name: current.name,
        relativePath: current.relativePath,
        url: current.url,
        sizeBytes: current.sizeBytes,
        modifiedAtUnixMs: current.modifiedAtUnixMs,
        resourceIdentity: current.resourceIdentity,
        identityKey: current.identityKey,
        metadataFingerprint: current.metadataFingerprint,
        status: status
      )
      self.indexRevision = "index-\(UUID().uuidString.lowercased())"
    }
  }

  /// File-presenter callbacks only mark state dirty. A later scan remains the source of truth.
  internal func noteExternalChange(at url: URL?) {
    queue.async { [weak self] in
      guard let self else { return }
      guard let paths = self.paths, let url,
            let relativePath = try? FlinkPathSafety.relativePath(of: url, within: paths.library)
      else {
        self.forceAllOnNextScan = true
        return
      }
      self.forcedRelativePaths.insert(self.canonicalRelativePath(relativePath))
    }
  }

  private func initializeOnQueue() throws -> FlinkStoragePaths {
    let resolved = try paths ?? FlinkStoragePaths.resolve(fileManager: fileManager)
    try resolved.ensureDirectories(
      cleanupStaging: !didInitialize,
      fileManager: fileManager
    )
    paths = resolved
    didInitialize = true
    return resolved
  }

  /// All requests arriving during one scan share a single pending rescan.
  private func drainScanRequestsOnQueue() {
    while true {
      let waiters: [CheckedContinuation<FlinkLibrarySnapshot, Error>] = scanStateLock.flinkWithLock {
        guard !scanWaiters.isEmpty else {
          scanWorkerRunning = false
          return []
        }
        let current = scanWaiters
        scanWaiters.removeAll(keepingCapacity: true)
        return current
      }
      guard !waiters.isEmpty else { return }
      let result = Result { try scanOnQueue() }
      for waiter in waiters {
        waiter.resume(with: result)
      }
    }
  }

  private func scanOnQueue() throws -> FlinkLibrarySnapshot {
    let paths = try initializeOnQueue()
    try validateLibraryRoot(paths.library)

    let keys: Set<URLResourceKey> = [
      .isDirectoryKey,
      .isRegularFileKey,
      .isSymbolicLinkKey,
      .isPackageKey,
      .fileSizeKey,
      .contentModificationDateKey,
      .fileResourceIdentifierKey,
      .isHiddenKey,
    ]
    var warnings = [FlinkLibraryWarning]()
    var rootEnumerationFailed = false
    guard let enumerator = fileManager.enumerator(
      at: paths.library,
      includingPropertiesForKeys: Array(keys),
      options: [.skipsHiddenFiles, .skipsPackageDescendants],
      errorHandler: { url, _ in
        if url.standardizedFileURL == paths.library.standardizedFileURL {
          rootEnumerationFailed = true
        }
        let relative = try? FlinkPathSafety.relativePath(of: url, within: paths.library)
        warnings.append(FlinkLibraryWarning(
          code: FlinkFileErrorCode.libraryUnavailable.rawValue,
          relativePath: relative
        ))
        return true
      }
    ) else {
      throw FlinkFilesException(.libraryUnavailable, operation: "scanLibrary")
    }

    var candidatesByIdentity = [String: Candidate]()
    while let item = enumerator.nextObject() as? URL {
      do {
        let values = try item.resourceValues(forKeys: keys)
        if values.isSymbolicLink == true || values.isPackage == true {
          if values.isDirectory == true {
            enumerator.skipDescendants()
          }
          continue
        }
        if values.isDirectory == true {
          continue
        }
        guard values.isRegularFile == true,
              item.pathExtension.caseInsensitiveCompare("pdf") == .orderedSame
        else {
          continue
        }

        try FlinkPathSafety.assertNoSymbolicLink(from: paths.library, through: item)
        let relativePath = try FlinkPathSafety.relativePath(of: item, within: paths.library)
        guard !item.lastPathComponent.hasPrefix(".flink-") else {
          continue
        }
        let sizeBytes = Int64(values.fileSize ?? 0)
        guard sizeBytes >= 0 else {
          throw FlinkFilesException(.libraryUnavailable, operation: "scanMetadata")
        }
        let modifiedAtUnixMs = values.contentModificationDate.map {
          $0.timeIntervalSince1970 * 1_000
        }
        let resourceIdentity = FlinkResourceIdentity.hashed(values.fileResourceIdentifier)
        let identityKey = resourceIdentity.map { "resource:\($0)" }
          ?? "path:\(canonicalRelativePath(relativePath))"
        let fingerprint = metadataFingerprint(
          relativePath: relativePath,
          sizeBytes: sizeBytes,
          modifiedAtUnixMs: modifiedAtUnixMs,
          resourceIdentity: resourceIdentity
        )
        let candidate = Candidate(
          name: item.lastPathComponent,
          relativePath: relativePath,
          url: item,
          sizeBytes: sizeBytes,
          modifiedAtUnixMs: modifiedAtUnixMs,
          resourceIdentity: resourceIdentity,
          identityKey: identityKey,
          metadataFingerprint: fingerprint
        )

        // A resource identifier can expose multiple hard-link paths. Keep one stable entry.
        if let existing = candidatesByIdentity[identityKey] {
          if relativePath.localizedStandardCompare(existing.relativePath) == .orderedAscending {
            candidatesByIdentity[identityKey] = candidate
          }
        } else {
          candidatesByIdentity[identityKey] = candidate
        }
      } catch {
        let relative = try? FlinkPathSafety.relativePath(of: item, within: paths.library)
        warnings.append(FlinkLibraryWarning(
          code: FlinkFileErrorCode.libraryUnavailable.rawValue,
          relativePath: relative
        ))
      }
    }

    if rootEnumerationFailed {
      throw FlinkFilesException(.libraryUnavailable, operation: "scanLibrary")
    }

    let candidates = candidatesByIdentity.values.sorted {
      $0.relativePath.localizedStandardCompare($1.relativePath) == .orderedAscending
    }
    var nextObservations = [String: Observation]()
    var nextIndex = [String: FlinkIndexedDocument]()

    for candidate in candidates {
      let forced = forceAllOnNextScan
        || forcedRelativePaths.contains(canonicalRelativePath(candidate.relativePath))
      let previous = observationsByIdentity[candidate.identityKey]
      let unchanged = previous?.metadataFingerprint == candidate.metadataFingerprint && !forced
      let fileId = previous?.fileId ?? UUID().uuidString.lowercased()
      let generation = unchanged ? (previous?.generation ?? 1) : (previous?.generation ?? 0) + 1
      let revision = FlinkHash.sha256(
        "v1|\(candidate.metadataFingerprint)|generation:\(generation)"
      )
      let observation = Observation(
        fileId: fileId,
        generation: generation,
        metadataFingerprint: candidate.metadataFingerprint
      )
      nextObservations[candidate.identityKey] = observation
      let previousStatus = indexedById[fileId]?.reference.revision == revision
        ? indexedById[fileId]?.status
        : nil
      let document = FlinkIndexedDocument(
        reference: FlinkDocumentReference(fileId: fileId, revision: revision),
        name: candidate.name,
        relativePath: candidate.relativePath,
        url: candidate.url,
        sizeBytes: candidate.sizeBytes,
        modifiedAtUnixMs: candidate.modifiedAtUnixMs,
        resourceIdentity: candidate.resourceIdentity,
        identityKey: candidate.identityKey,
        metadataFingerprint: candidate.metadataFingerprint,
        status: previousStatus ?? .unknown
      )
      nextIndex[fileId] = document
    }

    let oldSignature = indexSignature(indexedById)
    let newSignature = indexSignature(nextIndex)
    if oldSignature != newSignature {
      indexRevision = "index-\(UUID().uuidString.lowercased())"
    }
    indexedById = nextIndex
    observationsByIdentity = nextObservations
    forcedRelativePaths.removeAll(keepingCapacity: true)
    forceAllOnNextScan = false

    return FlinkLibrarySnapshot(
      scanId: "scan-\(UUID().uuidString.lowercased())",
      indexRevision: indexRevision,
      entries: nextIndex.values.sorted {
        $0.relativePath.localizedStandardCompare($1.relativePath) == .orderedAscending
      },
      warnings: warnings
    )
  }

  private func resolveOnQueue(
    _ reference: FlinkDocumentReference,
    operation: String
  ) throws -> FlinkResolvedDocument {
    let paths = try initializeOnQueue()
    guard let indexed = indexedById[reference.fileId] else {
      throw FlinkFilesException(.fileMissing, operation: operation)
    }
    guard indexed.reference.revision == reference.revision else {
      throw FlinkFilesException(.fileChanged, operation: operation)
    }

    do {
      try validateLibraryRoot(paths.library)
      try FlinkPathSafety.assertNoSymbolicLink(from: paths.library, through: indexed.url)
      let values = try indexed.url.resourceValues(forKeys: [
        .isRegularFileKey,
        .isDirectoryKey,
        .isSymbolicLinkKey,
        .fileSizeKey,
        .contentModificationDateKey,
        .fileResourceIdentifierKey,
      ])
      guard values.isRegularFile == true,
            values.isDirectory != true,
            values.isSymbolicLink != true
      else {
        throw FlinkFilesException(.pathOutsideLibrary, operation: operation)
      }
      let relativePath = try FlinkPathSafety.relativePath(of: indexed.url, within: paths.library)
      let sizeBytes = Int64(values.fileSize ?? 0)
      let modifiedAtUnixMs = values.contentModificationDate.map {
        $0.timeIntervalSince1970 * 1_000
      }
      let resourceIdentity = FlinkResourceIdentity.hashed(values.fileResourceIdentifier)
      let fingerprint = metadataFingerprint(
        relativePath: relativePath,
        sizeBytes: sizeBytes,
        modifiedAtUnixMs: modifiedAtUnixMs,
        resourceIdentity: resourceIdentity
      )
      guard fingerprint == indexed.metadataFingerprint else {
        forcedRelativePaths.insert(canonicalRelativePath(relativePath))
        throw FlinkFilesException(.fileChanged, operation: operation)
      }
      return FlinkResolvedDocument(
        reference: indexed.reference,
        name: indexed.name,
        relativePath: indexed.relativePath,
        url: indexed.url,
        libraryRoot: paths.library,
        sizeBytes: indexed.sizeBytes,
        modifiedAtUnixMs: indexed.modifiedAtUnixMs,
        resourceIdentity: indexed.resourceIdentity,
        runtimeGeneration: nil
      )
    } catch {
      if let flinkError = error as? FlinkFilesException {
        throw flinkError
      }
      let nsError = error as NSError
      if nsError.domain == NSCocoaErrorDomain,
         [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(nsError.code) {
        throw FlinkFilesException(.fileMissing, operation: operation)
      }
      throw FlinkFilesException.wrapping(
        error,
        operation: operation,
        fallback: .libraryUnavailable
      )
    }
  }

  private func renameOnQueue(
    _ reference: FlinkDocumentReference,
    newBaseName: String
  ) throws -> FlinkDocumentReference {
    let resolved = try resolveOnQueue(reference, operation: "renameDocument")
    let baseName = try validatedBaseName(newBaseName)
    let newName = "\(baseName).pdf"
    if newName == resolved.name {
      return resolved.reference
    }

    let destination = resolved.url.deletingLastPathComponent()
      .appendingPathComponent(newName, isDirectory: false)
    let paths = try initializeOnQueue()
    _ = try FlinkPathSafety.relativePath(of: destination, within: paths.library)
    try FlinkPathSafety.assertNoSymbolicLink(
      from: paths.library,
      through: destination.deletingLastPathComponent()
    )
    try rejectRenameConflict(
      destination: destination,
      source: resolved.url,
      sourceName: resolved.name
    )

    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordinationError: NSError?
    var accessorError: Error?
    coordinator.coordinate(
      writingItemAt: resolved.url,
      options: .forMoving,
      writingItemAt: destination,
      options: [],
      error: &coordinationError
    ) { coordinatedSource, coordinatedDestination in
      do {
        try self.revalidateResolvedDocument(resolved, coordinatedURL: coordinatedSource)
        try self.atomicRenameNoReplace(
          from: coordinatedSource,
          to: coordinatedDestination,
          allowCaseOnlyAliasOfSource: self.canonicalName(resolved.name)
            == self.canonicalName(newName)
        )
      } catch {
        accessorError = error
      }
    }
    if let coordinationError {
      throw FlinkFilesException.wrapping(
        coordinationError,
        operation: "renameDocument",
        fallback: .libraryUnavailable
      )
    }
    if let accessorError {
      throw accessorError
    }

    let expectedRelativePath = try FlinkPathSafety.relativePath(
      of: destination,
      within: paths.library
    )
    forcedRelativePaths.insert(canonicalRelativePath(expectedRelativePath))
    let snapshot = try scanOnQueue()
    guard let renamed = snapshot.entries.first(where: {
      $0.relativePath == expectedRelativePath
    }) else {
      throw FlinkFilesException(.fileMissing, operation: "renameDocument")
    }
    mutationHandler?(reference, "renamed")
    return renamed.reference
  }

  private func deleteOnQueue(_ reference: FlinkDocumentReference) throws {
    let resolved = try resolveOnQueue(reference, operation: "deleteDocument")
    let coordinator = NSFileCoordinator(filePresenter: nil)
    var coordinationError: NSError?
    var accessorError: Error?
    coordinator.coordinate(
      writingItemAt: resolved.url,
      options: .forDeleting,
      error: &coordinationError
    ) { coordinatedURL in
      do {
        try self.revalidateResolvedDocument(resolved, coordinatedURL: coordinatedURL)
        try self.fileManager.removeItem(at: coordinatedURL)
      } catch {
        accessorError = error
      }
    }
    if let coordinationError {
      throw FlinkFilesException.wrapping(
        coordinationError,
        operation: "deleteDocument",
        fallback: .libraryUnavailable
      )
    }
    if let accessorError {
      throw FlinkFilesException.wrapping(
        accessorError,
        operation: "deleteDocument",
        fallback: .libraryUnavailable
      )
    }

    _ = try scanOnQueue()
    mutationHandler?(reference, "deleted")
  }

  private func validateLibraryRoot(_ root: URL) throws {
    do {
      let values = try root.resourceValues(forKeys: [
        .isDirectoryKey,
        .isSymbolicLinkKey,
      ])
      guard values.isDirectory == true, values.isSymbolicLink != true else {
        throw FlinkFilesException(.libraryPathBlocked, operation: "validateLibraryRoot")
      }
    } catch {
      if let flinkError = error as? FlinkFilesException {
        throw flinkError
      }
      throw FlinkFilesException.wrapping(
        error,
        operation: "validateLibraryRoot",
        fallback: .libraryUnavailable
      )
    }
  }

  private func revalidateResolvedDocument(
    _ resolved: FlinkResolvedDocument,
    coordinatedURL: URL
  ) throws {
    let paths = try initializeOnQueue()
    try FlinkPathSafety.assertNoSymbolicLink(from: paths.library, through: coordinatedURL)
    let relativePath = try FlinkPathSafety.relativePath(of: coordinatedURL, within: paths.library)
    guard relativePath == resolved.relativePath else {
      throw FlinkFilesException(.fileChanged, operation: "revalidateDocument")
    }
    let values = try coordinatedURL.resourceValues(forKeys: [
      .isRegularFileKey,
      .isSymbolicLinkKey,
      .fileSizeKey,
      .contentModificationDateKey,
      .fileResourceIdentifierKey,
    ])
    guard values.isRegularFile == true, values.isSymbolicLink != true else {
      throw FlinkFilesException(.pathOutsideLibrary, operation: "revalidateDocument")
    }
    let fingerprint = metadataFingerprint(
      relativePath: relativePath,
      sizeBytes: Int64(values.fileSize ?? 0),
      modifiedAtUnixMs: values.contentModificationDate.map {
        $0.timeIntervalSince1970 * 1_000
      },
      resourceIdentity: FlinkResourceIdentity.hashed(values.fileResourceIdentifier)
    )
    guard fingerprint == indexedById[resolved.reference.fileId]?.metadataFingerprint else {
      throw FlinkFilesException(.fileChanged, operation: "revalidateDocument")
    }
  }

  private func rejectRenameConflict(
    destination: URL,
    source: URL,
    sourceName: String
  ) throws {
    let destinationCanonical = canonicalName(destination.lastPathComponent)
    let sourceCanonical = canonicalName(sourceName)
    let siblings = try fileManager.contentsOfDirectory(
      at: source.deletingLastPathComponent(),
      includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
      options: []
    )
    for sibling in siblings where sibling.standardizedFileURL != source.standardizedFileURL {
      if canonicalName(sibling.lastPathComponent) == destinationCanonical {
        throw FlinkFilesException(.nameConflict, operation: "renameDocument")
      }
    }
    if destinationCanonical != sourceCanonical,
       fileManager.fileExists(atPath: destination.path) {
      throw FlinkFilesException(.nameConflict, operation: "renameDocument")
    }
  }

  private func validatedBaseName(_ input: String) throws -> String {
    var baseName = input
    if baseName.lowercased(with: Locale(identifier: "en_US_POSIX")).hasSuffix(".pdf") {
      baseName.removeLast(4)
    }
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
      throw FlinkFilesException(.nameInvalid, operation: "renameDocument")
    }
    return baseName
  }

  private func atomicRenameNoReplace(
    from source: URL,
    to destination: URL,
    allowCaseOnlyAliasOfSource: Bool
  ) throws {
    let result = source.path.withCString { sourcePath in
      destination.path.withCString { destinationPath in
        renamex_np(sourcePath, destinationPath, UInt32(RENAME_EXCL))
      }
    }
    if result == 0 {
      return
    }
    let capturedErrno = errno
    if capturedErrno == EEXIST, allowCaseOnlyAliasOfSource,
       isSameResource(source, destination) {
      let caseOnlyResult = source.path.withCString { sourcePath in
        destination.path.withCString { destinationPath in
          rename(sourcePath, destinationPath)
        }
      }
      if caseOnlyResult == 0 {
        return
      }
      throw posixMutationError(errno, operation: "renameDocument")
    }
    if capturedErrno == EEXIST {
      throw FlinkFilesException(.nameConflict, operation: "renameDocument")
    }
    throw posixMutationError(capturedErrno, operation: "renameDocument")
  }

  private func isSameResource(_ lhs: URL, _ rhs: URL) -> Bool {
    guard let left = try? lhs.resourceValues(forKeys: [.fileResourceIdentifierKey]),
          let right = try? rhs.resourceValues(forKeys: [.fileResourceIdentifierKey]),
          let leftIdentity = FlinkResourceIdentity.hashed(left.fileResourceIdentifier),
          let rightIdentity = FlinkResourceIdentity.hashed(right.fileResourceIdentifier)
    else {
      return false
    }
    return leftIdentity == rightIdentity
  }

  private func posixMutationError(_ code: Int32, operation: String) -> FlinkFilesException {
    switch code {
    case EEXIST:
      return FlinkFilesException(.nameConflict, operation: operation)
    case ENOSPC, EDQUOT:
      return FlinkFilesException(.noSpace, operation: operation)
    case ENOENT:
      return FlinkFilesException(.fileMissing, operation: operation)
    case EACCES, EPERM:
      return FlinkFilesException(.libraryUnavailable, operation: operation)
    default:
      return FlinkFilesException(
        .libraryUnavailable,
        operation: operation,
        diagnostic: "POSIX:\(code)"
      )
    }
  }

  private func metadataFingerprint(
    relativePath: String,
    sizeBytes: Int64,
    modifiedAtUnixMs: Double?,
    resourceIdentity: String?
  ) -> String {
    let modifiedBits = modifiedAtUnixMs?.bitPattern.description ?? "unknown"
    return FlinkHash.sha256(
      "v1|\(canonicalRelativePath(relativePath))|\(sizeBytes)|\(modifiedBits)|\(resourceIdentity ?? "none")"
    )
  }

  private func indexSignature(_ index: [String: FlinkIndexedDocument]) -> String {
    let parts = index.values.map {
      "\($0.reference.fileId)|\($0.reference.revision)|\($0.relativePath)"
    }.sorted()
    return FlinkHash.sha256(parts.joined(separator: "\n"))
  }

  private func canonicalName(_ name: String) -> String {
    name.precomposedStringWithCanonicalMapping
      .lowercased(with: Locale(identifier: "en_US_POSIX"))
  }

  private func canonicalRelativePath(_ path: String) -> String {
    canonicalName(path)
  }

  private func perform<T>(_ operation: @escaping () throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
      queue.async {
        continuation.resume(with: Result(catching: operation))
      }
    }
  }

  private func performWithoutThrowing(_ operation: @escaping () -> Void) async {
    await withCheckedContinuation { continuation in
      queue.async {
        operation()
        continuation.resume()
      }
    }
  }
}
