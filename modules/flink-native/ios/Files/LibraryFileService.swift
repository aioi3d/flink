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

  private struct CoordinatedMutationURLs {
    let source: URL
    let sourceParent: URL
  }

  private struct POSIXFileSystemIdentity: Equatable, Sendable {
    let device: UInt64
    let inode: UInt64
  }

  /// `coordinate(with:queue:)` executes on a separate operation queue. Keep
  /// its single result behind a lock so the service queue can synchronously
  /// preserve the existing mutation API without sharing a captured `var`.
  private final class CoordinationOutcome: @unchecked Sendable {
    private let lock = NSLock()
    private var storedError: Error?

    func store(_ error: Error) {
      lock.flinkWithLock {
        storedError = error
      }
    }

    func error() -> Error? {
      lock.flinkWithLock { storedError }
    }
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
            values.isDirectory == false,
            values.isSymbolicLink == false
      else {
        throw FlinkFilesException(
          .pathOutsideLibrary,
          operation: operation,
          diagnostic: FlinkPathDiagnostic.resolveSourceKind.rawValue
        )
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

    let sourceParent = resolved.url.deletingLastPathComponent()
    let destination = sourceParent
      .appendingPathComponent(newName, isDirectory: false)
    let paths = try initializeOnQueue()
    let expectedRelativePath = try FlinkPathSafety.relativePath(
      of: destination,
      within: paths.library
    )
    try FlinkPathSafety.assertNoSymbolicLink(
      from: paths.library,
      through: sourceParent
    )
    try rejectRenameConflict(
      destination: destination,
      source: resolved.url,
      sourceParent: sourceParent,
      sourceName: resolved.name
    )

    try coordinateMutation(
      source: resolved.url,
      sourceParent: sourceParent,
      libraryRoot: paths.library,
      sourceOptions: .forMoving,
      operation: "renameDocument"
    ) { coordinatedSource, coordinatedParent, coordinatedLibraryRoot, coordinatedLibraryRootIdentity in
      let mutationURLs = try self.revalidateResolvedDocument(
        resolved,
        coordinatedSource: coordinatedSource,
        coordinatedParent: coordinatedParent,
        coordinatedLibraryRoot: coordinatedLibraryRoot,
        expectedLibraryRootIdentity: coordinatedLibraryRootIdentity,
        operation: "renameDocument"
      )
      // The parent intent supplies an existing accessor URL. After the root
      // containment proof below, derive the new leaf only from that URL rather
      // than from a non-existent destination or an assumed path spelling.
      let coordinatedDestination = mutationURLs.sourceParent
        .appendingPathComponent(newName, isDirectory: false)
      try self.rejectRenameConflict(
        destination: coordinatedDestination,
        source: mutationURLs.source,
        sourceParent: mutationURLs.sourceParent,
        sourceName: resolved.name,
        usesPromisedItemResourceValues: true
      )
      try self.atomicRenameNoReplace(
        from: mutationURLs.source,
        to: coordinatedDestination,
        allowCaseOnlyAliasOfSource: self.canonicalName(resolved.name)
          == self.canonicalName(newName),
        usesPromisedItemResourceValues: true
      )
    }

    forcedRelativePaths.insert(canonicalRelativePath(expectedRelativePath))
    let snapshot = try scanOnQueue()
    guard let renamed = snapshot.entries.first(where: {
      canonicalRelativePath($0.relativePath)
        == canonicalRelativePath(expectedRelativePath)
    }) else {
      throw FlinkFilesException(.fileMissing, operation: "renameDocument")
    }
    mutationHandler?(reference, "renamed")
    return renamed.reference
  }

  private func deleteOnQueue(_ reference: FlinkDocumentReference) throws {
    let resolved = try resolveOnQueue(reference, operation: "deleteDocument")
    let paths = try initializeOnQueue()
    try coordinateMutation(
      source: resolved.url,
      sourceParent: resolved.url.deletingLastPathComponent(),
      libraryRoot: paths.library,
      sourceOptions: .forDeleting,
      operation: "deleteDocument"
    ) { coordinatedSource, coordinatedParent, coordinatedLibraryRoot, coordinatedLibraryRootIdentity in
      let mutationURLs = try self.revalidateResolvedDocument(
        resolved,
        coordinatedSource: coordinatedSource,
        coordinatedParent: coordinatedParent,
        coordinatedLibraryRoot: coordinatedLibraryRoot,
        expectedLibraryRootIdentity: coordinatedLibraryRootIdentity,
        operation: "deleteDocument"
      )
      try self.fileManager.removeItem(at: mutationURLs.source)
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
      guard values.isDirectory == true, values.isSymbolicLink == false else {
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

  private func coordinateMutation(
    source: URL,
    sourceParent: URL,
    libraryRoot: URL,
    sourceOptions: NSFileCoordinator.WritingOptions,
    operation: String,
    accessor: @escaping @Sendable (
      URL,
      URL,
      URL,
      POSIXFileSystemIdentity
    ) throws -> Void
  ) throws {
    // A file move/delete, its existing parent directory, and the library root
    // are separate access intents. The parent coordinates the directory entry
    // mutation; the root is a stable, existing trust anchor used to rebuild
    // paths without trusting NSFileCoordinator accessor spelling.
    try validateLibraryRoot(libraryRoot)
    let expectedLibraryRootIdentity = try posixIdentity(
      of: libraryRoot,
      operation: operation
    )
    let sourceIntent = NSFileAccessIntent.writingIntent(
      with: source,
      options: sourceOptions
    )
    let rootIntent = NSFileAccessIntent.writingIntent(
      with: libraryRoot,
      options: []
    )
    let needsSeparateParent = sourceParent.standardizedFileURL
      != libraryRoot.standardizedFileURL
    let parentIntent = needsSeparateParent
      ? NSFileAccessIntent.writingIntent(with: sourceParent, options: [])
      : nil
    var intents: [NSFileAccessIntent] = [sourceIntent, rootIntent]
    if let parentIntent {
      intents.append(parentIntent)
    }

    let coordinator = NSFileCoordinator(filePresenter: nil)
    let accessQueue = OperationQueue()
    accessQueue.name = "com.aioi.flink.mutation-coordination"
    accessQueue.maxConcurrentOperationCount = 1
    accessQueue.qualityOfService = .userInitiated
    let completion = DispatchSemaphore(value: 0)
    let outcome = CoordinationOutcome()

    coordinator.coordinate(with: intents, queue: accessQueue) { error in
      defer { completion.signal() }
      if let error {
        outcome.store(error)
        return
      }
      do {
        try accessor(
          sourceIntent.url,
          parentIntent?.url ?? rootIntent.url,
          rootIntent.url,
          expectedLibraryRootIdentity
        )
      } catch {
        outcome.store(error)
      }
    }
    // Keep both Foundation coordination objects alive until the accessor has
    // completed without capturing the non-Sendable coordinator in it.
    withExtendedLifetime((coordinator, accessQueue)) {
      completion.wait()
    }

    if let error = outcome.error() {
      throw FlinkFilesException.wrapping(
        error,
        operation: operation,
        fallback: .libraryUnavailable
      )
    }
  }

  private func revalidateResolvedDocument(
    _ resolved: FlinkResolvedDocument,
    coordinatedSource: URL,
    coordinatedParent: URL,
    coordinatedLibraryRoot: URL,
    expectedLibraryRootIdentity: POSIXFileSystemIdentity,
    operation: String
  ) throws -> CoordinatedMutationURLs {
    try validateCoordinatedLibraryRoot(
      coordinatedLibraryRoot,
      expectedIdentity: expectedLibraryRootIdentity,
      operation: operation
    )
    let sourceComponents = try validatedRelativePathComponents(
      resolved.relativePath,
      operation: operation
    )
    let rootedSource = coordinatedURL(
      in: coordinatedLibraryRoot,
      components: sourceComponents
    )
    let rootedParent = rootedSource.deletingLastPathComponent()
    try assertNoCoordinatedSymbolicLink(
      from: coordinatedLibraryRoot,
      through: rootedSource,
      operation: operation
    )
    try validateCoordinatedParent(
      coordinatedParent,
      expectedParent: rootedParent,
      operation: operation
    )
    // Accessor URLs may have a different path structure or basename. Use the
    // rooted URL only as a containment proof, then retain the intent URLs for
    // the mutation as NSFileAccessIntent requires.
    guard try isSameFileSystemResource(
      coordinatedSource,
      rootedSource,
      operation: operation,
      usesPromisedItemResourceValues: true
    ) else {
      throw FlinkFilesException(.fileChanged, operation: operation)
    }
    let values = try resourceValues(
      for: coordinatedSource,
      keys: [
        .isRegularFileKey,
        .isSymbolicLinkKey,
        .fileSizeKey,
        .contentModificationDateKey,
        .fileResourceIdentifierKey,
      ],
      usesPromisedItemResourceValues: true
    )
    guard values.isRegularFile == true, values.isSymbolicLink == false else {
      throw FlinkFilesException(
        .pathOutsideLibrary,
        operation: operation,
        diagnostic: FlinkPathDiagnostic.coordinatedSourceKind.rawValue
      )
    }
    let fingerprint = metadataFingerprint(
      relativePath: resolved.relativePath,
      sizeBytes: Int64(values.fileSize ?? 0),
      modifiedAtUnixMs: values.contentModificationDate.map {
        $0.timeIntervalSince1970 * 1_000
      },
      // The source was already proved identical with Foundation's opaque-token
      // equality (or inode fallback). Reuse the scan-time identity so a
      // promised accessor representation cannot create a false revision.
      resourceIdentity: resolved.resourceIdentity
    )
    guard fingerprint == indexedById[resolved.reference.fileId]?.metadataFingerprint else {
      throw FlinkFilesException(.fileChanged, operation: operation)
    }
    return CoordinatedMutationURLs(
      source: coordinatedSource,
      sourceParent: coordinatedParent
    )
  }

  private func validateCoordinatedLibraryRoot(
    _ candidate: URL,
    expectedIdentity: POSIXFileSystemIdentity,
    operation: String
  ) throws {
    let values = try resourceValues(
      for: candidate,
      keys: [.isDirectoryKey, .isSymbolicLinkKey],
      usesPromisedItemResourceValues: true
    )
    guard values.isDirectory == true, values.isSymbolicLink == false else {
      throw FlinkFilesException(
        .pathOutsideLibrary,
        operation: operation,
        diagnostic: FlinkPathDiagnostic.coordinatedLibraryKind.rawValue
      )
    }
    guard try posixIdentity(of: candidate, operation: operation) == expectedIdentity else {
      throw FlinkFilesException(
        .pathOutsideLibrary,
        operation: operation,
        diagnostic: FlinkPathDiagnostic.coordinatedLibraryIdentity.rawValue
      )
    }
  }

  private func validateCoordinatedParent(
    _ candidate: URL,
    expectedParent: URL,
    operation: String
  ) throws {
    let values = try resourceValues(
      for: candidate,
      keys: [.isDirectoryKey, .isSymbolicLinkKey],
      usesPromisedItemResourceValues: true
    )
    guard values.isDirectory == true, values.isSymbolicLink == false else {
      throw FlinkFilesException(
        .pathOutsideLibrary,
        operation: operation,
        diagnostic: FlinkPathDiagnostic.coordinatedParentKind.rawValue
      )
    }
    guard try isSameFileSystemResource(
      candidate,
      expectedParent,
      operation: operation,
      usesPromisedItemResourceValues: true
    ) else {
      throw FlinkFilesException(
        .pathOutsideLibrary,
        operation: operation,
        diagnostic: FlinkPathDiagnostic.coordinatedParentIdentity.rawValue
      )
    }
  }

  private func validatedRelativePathComponents(
    _ relativePath: String,
    operation: String
  ) throws -> [String] {
    let components = relativePath.split(
      separator: "/",
      omittingEmptySubsequences: false
    ).map(String.init)
    guard !components.isEmpty,
          components.allSatisfy({
            !$0.isEmpty && $0 != "." && $0 != ".."
          })
    else {
      throw FlinkFilesException(
        .pathOutsideLibrary,
        operation: operation,
        diagnostic: FlinkPathDiagnostic.coordinatedInvalidRelativeComponents.rawValue
      )
    }
    return components
  }

  private func coordinatedURL(in root: URL, components: [String]) -> URL {
    components.reduce(root.standardizedFileURL) { partial, component in
      partial.appendingPathComponent(component, isDirectory: false)
    }
  }

  private func assertNoCoordinatedSymbolicLink(
    from root: URL,
    through candidate: URL,
    operation: String
  ) throws {
    let coordinatedRoot = root.standardizedFileURL
    let rootComponents = coordinatedRoot.pathComponents
    let candidateComponents = candidate.standardizedFileURL.pathComponents
    guard candidateComponents.count >= rootComponents.count,
          Array(candidateComponents.prefix(rootComponents.count)) == rootComponents
    else {
      throw FlinkFilesException(
        .pathOutsideLibrary,
        operation: operation,
        diagnostic: FlinkPathDiagnostic.coordinatedPathContainment.rawValue
      )
    }

    var current = coordinatedRoot
    for component in candidateComponents.dropFirst(rootComponents.count) {
      current.appendPathComponent(component, isDirectory: false)
      let values = try resourceValues(
        for: current,
        keys: [.isSymbolicLinkKey],
        usesPromisedItemResourceValues: true
      )
      guard values.isSymbolicLink == false else {
        throw FlinkFilesException(
          .pathOutsideLibrary,
          operation: operation,
          diagnostic: FlinkPathDiagnostic.coordinatedPathSymbolicLink.rawValue
        )
      }
    }
  }

  private func rejectRenameConflict(
    destination: URL,
    source: URL,
    sourceParent: URL,
    sourceName: String,
    usesPromisedItemResourceValues: Bool = false
  ) throws {
    let destinationCanonical = canonicalName(destination.lastPathComponent)
    let sourceCanonical = canonicalName(sourceName)
    let siblings = try fileManager.contentsOfDirectory(
      at: sourceParent,
      includingPropertiesForKeys: nil,
      options: []
    )
    for sibling in siblings where canonicalName(sibling.lastPathComponent) == destinationCanonical {
      if destinationCanonical == sourceCanonical,
         try isSameFileSystemResource(
           sibling,
           source,
           operation: "renameDocument",
           usesPromisedItemResourceValues: usesPromisedItemResourceValues
         ) {
        continue
      }
      throw FlinkFilesException(.nameConflict, operation: "renameDocument")
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
    allowCaseOnlyAliasOfSource: Bool,
    usesPromisedItemResourceValues: Bool = false
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
    if capturedErrno == EEXIST, allowCaseOnlyAliasOfSource {
      let destinationAliasesSource = try isSameFileSystemResource(
        source,
        destination,
        operation: "renameDocument",
        usesPromisedItemResourceValues: usesPromisedItemResourceValues
      )
      if destinationAliasesSource {
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
    }
    if capturedErrno == EEXIST {
      throw FlinkFilesException(.nameConflict, operation: "renameDocument")
    }
    throw posixMutationError(capturedErrno, operation: "renameDocument")
  }

  private func resourceValues(
    for url: URL,
    keys: Set<URLResourceKey>,
    usesPromisedItemResourceValues: Bool
  ) throws -> URLResourceValues {
    if usesPromisedItemResourceValues {
      // Foundation requires this API for URLs consulted inside a .forMoving
      // or .forDeleting coordinator accessor.
      return try url.promisedItemResourceValues(forKeys: keys)
    }
    return try url.resourceValues(forKeys: keys)
  }

  private func isSameFileSystemResource(
    _ lhs: URL,
    _ rhs: URL,
    operation: String,
    usesPromisedItemResourceValues: Bool = false
  ) throws -> Bool {
    let keys: Set<URLResourceKey> = [.fileResourceIdentifierKey]
    let left = try resourceValues(
      for: lhs,
      keys: keys,
      usesPromisedItemResourceValues: usesPromisedItemResourceValues
    )
    let right = try resourceValues(
      for: rhs,
      keys: keys,
      usesPromisedItemResourceValues: usesPromisedItemResourceValues
    )
    if let leftIdentifier = left.fileResourceIdentifier,
       let rightIdentifier = right.fileResourceIdentifier {
      // File resource identifiers are opaque equality tokens. Their archived
      // bytes are not a canonical representation; Foundation requires isEqual.
      return leftIdentifier.isEqual(rightIdentifier)
    }
    // Some promised URLs do not expose fileResourceIdentifier. Fall back only
    // in that case; a present but non-equal identifier remains fail-closed.
    return try hasSamePOSIXIdentity(lhs, rhs, operation: operation)
  }

  private func hasSamePOSIXIdentity(
    _ lhs: URL,
    _ rhs: URL,
    operation: String
  ) throws -> Bool {
    let left = try posixIdentity(of: lhs, operation: operation)
    let right = try posixIdentity(of: rhs, operation: operation)
    return left == right
  }

  private func posixIdentity(
    of url: URL,
    operation: String
  ) throws -> POSIXFileSystemIdentity {
    guard url.isFileURL else {
      throw FlinkFilesException(
        .pathOutsideLibrary,
        operation: operation,
        diagnostic: FlinkPathDiagnostic.nonFileIdentityURL.rawValue
      )
    }
    var status = stat()
    let result = url.path.withCString { stat($0, &status) }
    guard result == 0 else {
      throw posixMutationError(errno, operation: operation)
    }
    return POSIXFileSystemIdentity(
      device: UInt64(status.st_dev),
      inode: UInt64(status.st_ino)
    )
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
