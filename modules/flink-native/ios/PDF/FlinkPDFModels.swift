import Foundation

internal enum FlinkPDFReaderState: String {
  case ready
  case navigating
  case suspended
  case closed
  case error
}

internal struct FlinkPDFSnapshot {
  let readerSessionId: String
  let document: FlinkDocumentRefRecord
  let pageIndex: Int
  let pageCount: Int
  let stateRevision: Int
  let state: FlinkPDFReaderState

  var wireValue: [String: Any] {
    [
      "readerSessionId": readerSessionId,
      "document": [
        "fileId": document.fileId,
        "revision": document.revision
      ],
      "pageIndex": pageIndex,
      "pageCount": pageCount,
      "stateRevision": stateRevision,
      "state": state.rawValue
    ]
  }
}

internal enum FlinkPDFNavigateDisposition: String {
  case applied
  case boundary
  case busy
  case stale
  case suspended
  case duplicate
}

internal struct FlinkPDFNavigateResult {
  let commandId: String
  let result: FlinkPDFNavigateDisposition
  let snapshot: FlinkPDFSnapshot

  var wireValue: [String: Any] {
    [
      "commandId": commandId,
      "result": result.rawValue,
      "snapshot": snapshot.wireValue
    ]
  }
}

/// A fixed-capacity insertion-ordered set. Every accepted command attempt is
/// remembered, including boundary/busy/stale/suspended outcomes, so a blink is
/// never replayed after conditions change.
internal struct FlinkPDFRecentCommandIds {
  private let capacity: Int
  private var order: [String] = []
  private var members: Set<String> = []

  init(capacity: Int = 256) {
    self.capacity = max(1, capacity)
  }

  mutating func insert(_ commandId: String) -> Bool {
    guard !members.contains(commandId) else {
      return false
    }

    members.insert(commandId)
    order.append(commandId)

    if order.count > capacity {
      let evicted = order.removeFirst()
      members.remove(evicted)
    }
    return true
  }

  mutating func removeAll() {
    order.removeAll(keepingCapacity: true)
    members.removeAll(keepingCapacity: true)
  }
}
