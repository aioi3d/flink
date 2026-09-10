import Foundation
import PDFKit

/// PDFDocument is created and inspected on one serial queue. The wrapper is
/// the explicit one-way ownership hand-off to the main-thread PDFView.
internal final class FlinkLoadedPDFDocument: @unchecked Sendable {
  let document: PDFDocument
  let pageCount: Int

  init(document: PDFDocument, pageCount: Int) {
    self.document = document
    self.pageCount = pageCount
  }
}

internal final class FlinkPDFLoadTicket: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false

  func cancel() {
    lock.lock()
    cancelled = true
    lock.unlock()
  }

  var isCancelled: Bool {
    lock.lock()
    let value = cancelled
    lock.unlock()
    return value
  }
}

internal final class FlinkPDFDocumentLoader: @unchecked Sendable {
  /// Process-wide so overlapping React view lifetimes cannot start multiple
  /// large PDF parses at once. Thumbnail work intentionally uses another queue.
  private static let queue = DispatchQueue(
    label: "com.aioi.flink.pdf-loader",
    qos: .userInitiated
  )

  func load(
    url: URL,
    ticket: FlinkPDFLoadTicket
  ) async throws -> FlinkLoadedPDFDocument {
    try await withCheckedThrowingContinuation { continuation in
      Self.queue.async {
        guard !ticket.isCancelled else {
          continuation.resume(throwing: FlinkPDFErrors.supersededOpen())
          return
        }
        guard url.isFileURL else {
          continuation.resume(throwing: FlinkPDFErrors.invalid())
          return
        }

        let coordinator = NSFileCoordinator(filePresenter: nil)
        var coordinationError: NSError?
        var outcome: Result<FlinkLoadedPDFDocument, Error>?
        coordinator.coordinate(
          readingItemAt: url,
          options: [],
          error: &coordinationError
        ) { coordinatedURL in
          outcome = Result {
            try self.loadCoordinated(url: coordinatedURL, ticket: ticket)
          }
        }

        if let coordinationError {
          let code = CocoaError.Code(rawValue: coordinationError.code)
          if code == .fileNoSuchFile || code == .fileReadNoSuchFile {
            continuation.resume(
              throwing: FlinkPDFErrors.missing(operation: "openDocument")
            )
          } else {
            continuation.resume(
              throwing: FlinkPDFErrors.changed(operation: "openDocument")
            )
          }
          return
        }

        guard let outcome else {
          continuation.resume(throwing: FlinkPDFErrors.invalid())
          return
        }
        continuation.resume(with: outcome)
      }
    }
  }

  private func loadCoordinated(
    url: URL,
    ticket: FlinkPDFLoadTicket
  ) throws -> FlinkLoadedPDFDocument {
    guard !ticket.isCancelled else {
      throw FlinkPDFErrors.supersededOpen()
    }
    guard FileManager.default.fileExists(atPath: url.path) else {
      throw FlinkPDFErrors.missing(operation: "openDocument")
    }
    guard let document = PDFDocument(url: url) else {
      throw FlinkPDFErrors.invalid()
    }
    guard !document.isLocked else {
      throw FlinkPDFErrors.locked()
    }

    let pageCount = document.pageCount
    guard pageCount > 0 else {
      throw FlinkPDFErrors.empty()
    }
    guard document.page(at: 0) != nil else {
      throw FlinkPDFErrors.invalid()
    }
    guard !ticket.isCancelled else {
      throw FlinkPDFErrors.supersededOpen()
    }
    return FlinkLoadedPDFDocument(document: document, pageCount: pageCount)
  }
}
