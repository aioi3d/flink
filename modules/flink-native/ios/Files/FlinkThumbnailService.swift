import Foundation
import PDFKit
import UIKit

private final class FlinkThumbnailRequest {
  let requestId: String
  let document: FlinkDocumentReference
  let runtimeGeneration: UInt64
  let continuation: CheckedContinuation<[String: Any], Never>

  init(
    requestId: String,
    document: FlinkDocumentReference,
    runtimeGeneration: UInt64,
    continuation: CheckedContinuation<[String: Any], Never>
  ) {
    self.requestId = requestId
    self.document = document
    self.runtimeGeneration = runtimeGeneration
    self.continuation = continuation
  }
}

private final class FlinkThumbnailJob {
  let cacheKey: String
  let resolved: FlinkResolvedDocument
  let generation: UInt64
  var requests: [String: FlinkThumbnailRequest]

  init(
    cacheKey: String,
    resolved: FlinkResolvedDocument,
    generation: UInt64,
    request: FlinkThumbnailRequest
  ) {
    self.cacheKey = cacheKey
    self.resolved = resolved
    self.generation = generation
    self.requests = [request.requestId: request]
  }
}

internal final class FlinkThumbnailService: @unchecked Sendable {
  private static let algorithmVersion = "pdfkit-page0-v1"
  private static let maximumQueuedJobs = 64
  private static let maximumRequestsPerJob = 64
  private static let decodedCacheLimit = 32 * 1_024 * 1_024
  private static let diskCacheLimit: Int64 = 128 * 1_024 * 1_024

  private let queue = DispatchQueue(label: "com.aioi.flink.thumbnails", qos: .utility)
  private let lock = NSLock()
  private let fileManager: FileManager
  private let decodedCache = NSCache<NSString, UIImage>()
  private var pending = [FlinkThumbnailJob]()
  private var active: FlinkThumbnailJob?
  private var readerActive = false
  private var resourcePressurePaused = false
  private var cacheGeneration: UInt64 = 1
  private var highestRetiredRuntimeGeneration: UInt64?
  private var notificationTokens = [NSObjectProtocol]()

  internal init(fileManager: FileManager = .default) {
    self.fileManager = fileManager
    decodedCache.totalCostLimit = Self.decodedCacheLimit
    let center = NotificationCenter.default
    notificationTokens.append(center.addObserver(
      forName: UIApplication.didReceiveMemoryWarningNotification,
      object: nil,
      queue: nil
    ) { [weak self] _ in
      self?.handleMemoryWarning()
    })
    notificationTokens.append(center.addObserver(
      forName: ProcessInfo.thermalStateDidChangeNotification,
      object: nil,
      queue: nil
    ) { [weak self] _ in
      self?.handleThermalStateChange()
    })
    notificationTokens.append(center.addObserver(
      forName: UIApplication.didBecomeActiveNotification,
      object: nil,
      queue: nil
    ) { [weak self] _ in
      self?.resumeAfterPressureIfSafe()
    })
  }

  deinit {
    for token in notificationTokens {
      NotificationCenter.default.removeObserver(token)
    }
  }

  internal func requestThumbnail(
    document record: FlinkDocumentRefRecord,
    requestId: String,
    libraryService: FlinkLibraryFileService,
    runtimeGeneration: UInt64,
    isRuntimeGenerationActive: @escaping @Sendable () -> Bool
  ) async throws -> [String: Any] {
    guard FlinkIdentifier.isValid(requestId) else {
      throw FlinkFilesException(.invalidArgument, operation: "requestThumbnail")
    }
    let resolved = try await libraryService.resolveDocument(
      record,
      operation: "requestThumbnail"
    )
    guard isRuntimeGenerationActive() else {
      return result(
        document: resolved.reference,
        cacheURL: nil,
        status: "cancelled"
      )
    }
    let key = cacheKey(for: resolved)
    return await withCheckedContinuation { continuation in
      let request = FlinkThumbnailRequest(
        requestId: requestId,
        document: resolved.reference,
        runtimeGeneration: runtimeGeneration,
        continuation: continuation
      )
      enqueue(request, resolved: resolved, cacheKey: key)
    }
  }

  internal func cancel(requestId: String) {
    guard FlinkIdentifier.isValid(requestId) else { return }
    var cancelledRequest: FlinkThumbnailRequest?
    lock.flinkWithLock {
      for index in pending.indices {
        if let request = pending[index].requests.removeValue(forKey: requestId) {
          cancelledRequest = request
          if pending[index].requests.isEmpty {
            pending.remove(at: index)
          }
          break
        }
      }
      if cancelledRequest == nil,
         let request = active?.requests.removeValue(forKey: requestId) {
        cancelledRequest = request
      }
    }
    if let cancelledRequest {
      cancelledRequest.continuation.resume(returning: result(
        document: cancelledRequest.document,
        cacheURL: nil,
        status: "cancelled"
      ))
    }
  }

  internal func setReaderActive(_ isActive: Bool) {
    lock.flinkWithLock {
      readerActive = isActive
    }
  }

  internal func cancelAll(runtimeGeneration: UInt64) {
    var cancelled = [FlinkThumbnailRequest]()
    lock.flinkWithLock {
      highestRetiredRuntimeGeneration = max(
        highestRetiredRuntimeGeneration ?? runtimeGeneration,
        runtimeGeneration
      )
      for index in pending.indices.reversed() {
        let requestIds = pending[index].requests.values
          .filter { $0.runtimeGeneration == runtimeGeneration }
          .map(\.requestId)
        for requestId in requestIds {
          if let request = pending[index].requests.removeValue(forKey: requestId) {
            cancelled.append(request)
          }
        }
        if pending[index].requests.isEmpty {
          pending.remove(at: index)
        }
      }
      if let active {
        let requestIds = active.requests.values
          .filter { $0.runtimeGeneration == runtimeGeneration }
          .map(\.requestId)
        for requestId in requestIds {
          if let request = active.requests.removeValue(forKey: requestId) {
            cancelled.append(request)
          }
        }
      }
    }
    for request in cancelled {
      request.continuation.resume(returning: result(
        document: request.document,
        cacheURL: nil,
        status: "cancelled"
      ))
    }
  }

  internal func invalidateAll() {
    decodedCache.removeAllObjects()
    lock.flinkWithLock {
      cacheGeneration &+= 1
    }
    queue.async { [weak self] in
      guard let self else { return }
      guard let paths = try? FlinkStoragePaths.resolve(fileManager: self.fileManager) else {
        return
      }
      let files = (try? self.fileManager.contentsOfDirectory(
        at: paths.thumbnails,
        includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
        options: [.skipsHiddenFiles]
      )) ?? []
      for url in files where url.pathExtension.caseInsensitiveCompare("jpg") == .orderedSame {
        let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
        if values?.isRegularFile == true, values?.isSymbolicLink != true {
          try? self.fileManager.removeItem(at: url)
        }
      }
    }
  }

  private func enqueue(
    _ request: FlinkThumbnailRequest,
    resolved: FlinkResolvedDocument,
    cacheKey: String
  ) {
    var immediatelyCancelled = [FlinkThumbnailRequest]()
    lock.flinkWithLock {
      immediatelyCancelled.append(contentsOf: removeRequestLocked(request.requestId))
      if let retired = highestRetiredRuntimeGeneration,
         request.runtimeGeneration <= retired {
        immediatelyCancelled.append(request)
        return
      }
      if active?.cacheKey == cacheKey, active?.generation == cacheGeneration {
        if let active, active.requests.count >= Self.maximumRequestsPerJob,
           let evicted = active.requests.values.first {
          active.requests.removeValue(forKey: evicted.requestId)
          immediatelyCancelled.append(evicted)
        }
        active?.requests[request.requestId] = request
        return
      }
      if let existing = pending.first(where: {
        $0.cacheKey == cacheKey && $0.generation == cacheGeneration
      }) {
        if existing.requests.count >= Self.maximumRequestsPerJob,
           let evicted = existing.requests.values.first {
          existing.requests.removeValue(forKey: evicted.requestId)
          immediatelyCancelled.append(evicted)
        }
        existing.requests[request.requestId] = request
        return
      }
      if pending.count >= Self.maximumQueuedJobs {
        let evicted = pending.removeFirst()
        immediatelyCancelled.append(contentsOf: evicted.requests.values)
      }
      pending.append(FlinkThumbnailJob(
        cacheKey: cacheKey,
        resolved: resolved,
        generation: cacheGeneration,
        request: request
      ))
    }
    for request in immediatelyCancelled {
      request.continuation.resume(returning: result(
        document: request.document,
        cacheURL: nil,
        status: "cancelled"
      ))
    }
    queue.async { [weak self] in
      self?.drainOnQueue()
    }
  }

  private func removeRequestLocked(_ requestId: String) -> [FlinkThumbnailRequest] {
    var removed = [FlinkThumbnailRequest]()
    for index in pending.indices.reversed() {
      if let request = pending[index].requests.removeValue(forKey: requestId) {
        removed.append(request)
      }
      if pending[index].requests.isEmpty {
        pending.remove(at: index)
      }
    }
    if let request = active?.requests.removeValue(forKey: requestId) {
      removed.append(request)
    }
    return removed
  }

  private func drainOnQueue() {
    while true {
      let job: FlinkThumbnailJob? = lock.flinkWithLock {
        guard active == nil, !pending.isEmpty else { return nil }
        let next = pending.removeFirst()
        active = next
        return next
      }
      guard let job else { return }
      let output = generateOnQueue(job)
      let requests: [FlinkThumbnailRequest] = lock.flinkWithLock {
        let values = Array(job.requests.values)
        if active === job {
          active = nil
        }
        return values
      }
      for request in requests {
        request.continuation.resume(returning: result(
          document: request.document,
          cacheURL: output.cacheURL,
          status: output.status
        ))
      }
    }
  }

  private func generateOnQueue(
    _ job: FlinkThumbnailJob
  ) -> (cacheURL: URL?, status: String) {
    guard hasLiveRequests(job) else {
      return (nil, "cancelled")
    }
    do {
      let paths = try FlinkStoragePaths.resolve(fileManager: fileManager)
      try paths.ensureDirectories(cleanupStaging: false, fileManager: fileManager)
      let destination = paths.thumbnails
        .appendingPathComponent("\(job.cacheKey).jpg", isDirectory: false)
      guard !generationPaused else {
        return (nil, "unavailable")
      }

      var coordinationError: NSError?
      var output: (URL?, String) = (nil, "unavailable")
      NSFileCoordinator(filePresenter: nil).coordinate(
        readingItemAt: job.resolved.url,
        options: .withoutChanges,
        error: &coordinationError
      ) { coordinatedURL in
        guard self.isResolvedDocumentCurrent(job.resolved, at: coordinatedURL),
              self.isCurrentGeneration(job) else {
          output = (nil, "unavailable")
          return
        }
        if self.isSafeCachedFile(destination, inside: paths.thumbnails) {
          self.touch(destination)
          output = (destination, "ready")
        } else {
          output = self.render(
            coordinatedURL: coordinatedURL,
            job: job,
            destination: destination
          )
        }
      }
      if coordinationError != nil {
        return (nil, "unavailable")
      }
      return output
    } catch {
      return (nil, "unavailable")
    }
  }

  private func render(
    coordinatedURL: URL,
    job: FlinkThumbnailJob,
    destination: URL
  ) -> (URL?, String) {
    guard hasLiveRequests(job) else {
      return (nil, "cancelled")
    }
    guard !generationPaused, isCurrentGeneration(job) else {
      return (nil, "unavailable")
    }
    do {
      try FlinkPathSafety.assertNoSymbolicLink(
        from: job.resolved.libraryRoot,
        through: coordinatedURL
      )
      guard isResolvedDocumentCurrent(job.resolved, at: coordinatedURL) else {
        return (nil, "unavailable")
      }

      guard let pdf = PDFDocument(url: coordinatedURL) else {
        return (nil, "invalid")
      }
      if pdf.isLocked {
        return (nil, "locked")
      }
      guard pdf.pageCount > 0, let firstPage = pdf.page(at: 0) else {
        return (nil, "invalid")
      }
      let bounds = firstPage.bounds(for: .cropBox)
      guard bounds.width.isFinite,
            bounds.height.isFinite,
            bounds.width > 0,
            bounds.height > 0
      else {
        return (nil, "invalid")
      }
      let scale = min(1, 512 / max(bounds.width, bounds.height))
      let targetSize = CGSize(
        width: max(1, floor(bounds.width * scale)),
        height: max(1, floor(bounds.height * scale))
      )
      let pdfKitImage = firstPage.thumbnail(of: targetSize, for: .cropBox)
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = true
      let image = UIGraphicsImageRenderer(size: targetSize, format: format).image { context in
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: targetSize))
        pdfKitImage.draw(in: CGRect(origin: .zero, size: targetSize))
      }
      guard hasLiveRequests(job) else {
        return (nil, "cancelled")
      }
      guard !generationPaused, isCurrentGeneration(job) else {
        return (nil, "unavailable")
      }
      guard let jpeg = image.jpegData(compressionQuality: 0.84) else {
        return (nil, "invalid")
      }
      try jpeg.write(to: destination, options: .atomic)
      let postWriteStatus = adoptionStatus(for: job)
      guard postWriteStatus == "ready" else {
        if isSafeCachedFile(destination, inside: destination.deletingLastPathComponent()) {
          try? fileManager.removeItem(at: destination)
        }
        return (nil, postWriteStatus)
      }
      let pixelCost = Int(targetSize.width) * Int(targetSize.height) * 4
      decodedCache.setObject(image, forKey: job.cacheKey as NSString, cost: pixelCost)
      trimDiskCache(keeping: destination)
      return (destination, "ready")
    } catch {
      return (nil, "unavailable")
    }
  }

  private var generationPaused: Bool {
    lock.flinkWithLock { readerActive || resourcePressurePaused }
  }

  private func hasLiveRequests(_ job: FlinkThumbnailJob) -> Bool {
    lock.flinkWithLock { !job.requests.isEmpty }
  }

  private func isCurrentGeneration(_ job: FlinkThumbnailJob) -> Bool {
    lock.flinkWithLock { cacheGeneration == job.generation }
  }

  private func adoptionStatus(for job: FlinkThumbnailJob) -> String {
    lock.flinkWithLock {
      guard !job.requests.isEmpty else { return "cancelled" }
      guard cacheGeneration == job.generation,
            !readerActive,
            !resourcePressurePaused else {
        return "unavailable"
      }
      return "ready"
    }
  }

  private func isResolvedDocumentCurrent(
    _ document: FlinkResolvedDocument,
    at coordinatedURL: URL
  ) -> Bool {
    do {
      try FlinkPathSafety.assertNoSymbolicLink(
        from: document.libraryRoot,
        through: coordinatedURL
      )
      let relativePath = try FlinkPathSafety.relativePath(
        of: coordinatedURL,
        within: document.libraryRoot
      )
      let values = try coordinatedURL.resourceValues(forKeys: [
        .isRegularFileKey,
        .isSymbolicLinkKey,
        .fileSizeKey,
        .contentModificationDateKey,
        .fileResourceIdentifierKey,
      ])
      let modifiedAt = values.contentModificationDate.map {
        $0.timeIntervalSince1970 * 1_000
      }
      return relativePath == document.relativePath
        && values.isRegularFile == true
        && values.isSymbolicLink != true
        && Int64(values.fileSize ?? 0) == document.sizeBytes
        && modifiedAt == document.modifiedAtUnixMs
        && FlinkResourceIdentity.hashed(values.fileResourceIdentifier)
          == document.resourceIdentity
    } catch {
      return false
    }
  }

  private func cacheKey(for document: FlinkResolvedDocument) -> String {
    FlinkHash.sha256([
      Self.algorithmVersion,
      document.relativePath.precomposedStringWithCanonicalMapping,
      document.resourceIdentity ?? "none",
      String(document.sizeBytes),
      document.modifiedAtUnixMs?.bitPattern.description ?? "unknown",
      document.reference.revision,
    ].joined(separator: "|"))
  }

  private func result(
    document: FlinkDocumentReference,
    cacheURL: URL?,
    status: String
  ) -> [String: Any] {
    [
      "document": document.dictionary,
      "cacheUri": cacheURL?.absoluteString ?? NSNull(),
      "status": status,
    ]
  }

  private func isSafeCachedFile(_ url: URL, inside root: URL) -> Bool {
    guard FlinkPathSafety.contains(url, within: root),
          let values = try? url.resourceValues(forKeys: [
            .isRegularFileKey,
            .isSymbolicLinkKey,
          ])
    else {
      return false
    }
    return values.isRegularFile == true && values.isSymbolicLink != true
  }

  private func touch(_ url: URL) {
    try? fileManager.setAttributes(
      [.modificationDate: Date()],
      ofItemAtPath: url.path
    )
  }

  private func trimDiskCache(keeping protectedURL: URL) {
    let root = protectedURL.deletingLastPathComponent()
    let urls = (try? fileManager.contentsOfDirectory(
      at: root,
      includingPropertiesForKeys: [
        .isRegularFileKey,
        .isSymbolicLinkKey,
        .fileSizeKey,
        .contentModificationDateKey,
      ],
      options: [.skipsHiddenFiles]
    )) ?? []
    var entries = [(url: URL, size: Int64, modified: Date)]()
    var total: Int64 = 0
    for url in urls where url.pathExtension.caseInsensitiveCompare("jpg") == .orderedSame {
      guard let values = try? url.resourceValues(forKeys: [
        .isRegularFileKey,
        .isSymbolicLinkKey,
        .fileSizeKey,
        .contentModificationDateKey,
      ]), values.isRegularFile == true, values.isSymbolicLink != true else {
        continue
      }
      let size = Int64(values.fileSize ?? 0)
      let safeSize = max(0, size)
      let (nextTotal, overflow) = total.addingReportingOverflow(safeSize)
      total = overflow ? Int64.max : nextTotal
      entries.append((url, safeSize, values.contentModificationDate ?? .distantPast))
    }
    guard total > Self.diskCacheLimit else { return }
    for entry in entries.sorted(by: { $0.modified < $1.modified }) {
      if total <= Self.diskCacheLimit { break }
      if entry.url.standardizedFileURL == protectedURL.standardizedFileURL { continue }
      if (try? fileManager.removeItem(at: entry.url)) != nil {
        total -= entry.size
      }
    }
  }

  private func handleMemoryWarning() {
    decodedCache.removeAllObjects()
    lock.flinkWithLock {
      resourcePressurePaused = true
    }
  }

  private func handleThermalStateChange() {
    let thermal = ProcessInfo.processInfo.thermalState
    let shouldPause = thermal == .serious || thermal == .critical
    if shouldPause {
      decodedCache.removeAllObjects()
    }
    lock.flinkWithLock {
      resourcePressurePaused = shouldPause
    }
  }

  private func resumeAfterPressureIfSafe() {
    let thermal = ProcessInfo.processInfo.thermalState
    guard thermal == .nominal || thermal == .fair else { return }
    lock.flinkWithLock {
      resourcePressurePaused = false
    }
  }
}
