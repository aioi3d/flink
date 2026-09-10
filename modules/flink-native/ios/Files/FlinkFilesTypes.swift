import CryptoKit
import Darwin
import ExpoModulesCore
import Foundation

internal enum FlinkFileErrorCode: String {
  case libraryPathBlocked = "E_LIBRARY_PATH_BLOCKED"
  case libraryUnavailable = "E_LIBRARY_UNAVAILABLE"
  case importPermission = "E_IMPORT_PERMISSION"
  case providerUnavailable = "E_PROVIDER_UNAVAILABLE"
  case noSpace = "E_NO_SPACE"
  case notPDF = "E_NOT_PDF"
  case pdfLocked = "E_PDF_LOCKED"
  case pdfInvalid = "E_PDF_INVALID"
  case pdfEmpty = "E_PDF_EMPTY"
  case fileMissing = "E_FILE_MISSING"
  case fileChanged = "E_FILE_CHANGED"
  case nameInvalid = "E_NAME_INVALID"
  case nameConflict = "E_NAME_CONFLICT"
  case pathOutsideLibrary = "E_PATH_OUTSIDE_LIBRARY"
  case importBusy = "E_IMPORT_BUSY"
  case thumbnailQueueFull = "E_THUMBNAIL_QUEUE_FULL"
  case invalidArgument = "E_INVALID_ARGUMENT"
  case nativeRuntimeMismatch = "E_NATIVE_RUNTIME_MISMATCH"
}

/// Expo receives a stable code while the reason deliberately omits paths and PDF data.
internal final class FlinkFilesException: Exception {
  private let flinkCode: FlinkFileErrorCode
  private let operationName: String
  private let diagnostic: String?

  internal init(
    _ code: FlinkFileErrorCode,
    operation: String,
    diagnostic: String? = nil
  ) {
    self.flinkCode = code
    self.operationName = operation
    self.diagnostic = diagnostic
    super.init()
  }

  override var code: String {
    flinkCode.rawValue
  }

  override var reason: String {
    var parts = ["operation=\(operationName)"]
    if let diagnostic, !diagnostic.isEmpty {
      parts.append("diagnostic=\(diagnostic)")
    }
    return parts.joined(separator: ";")
  }

  internal static func wrapping(
    _ error: Error,
    operation: String,
    fallback: FlinkFileErrorCode
  ) -> FlinkFilesException {
    if let flinkError = error as? FlinkFilesException {
      return flinkError
    }

    let cocoaError = error as NSError
    let code: FlinkFileErrorCode
    if cocoaError.domain == NSPOSIXErrorDomain {
      switch Int32(cocoaError.code) {
      case ENOSPC, EDQUOT:
        code = .noSpace
      case EACCES, EPERM:
        code = fallback == .providerUnavailable ? .importPermission : fallback
      case ENOENT:
        code = .fileMissing
      default:
        code = fallback
      }
    } else if cocoaError.domain == NSCocoaErrorDomain {
      switch CocoaError.Code(rawValue: cocoaError.code) {
      case .fileReadNoPermission, .fileWriteNoPermission:
        code = codeFallbackPermission(fallback)
      case .fileWriteOutOfSpace:
        code = .noSpace
      case .fileNoSuchFile, .fileReadNoSuchFile:
        code = .fileMissing
      default:
        code = fallback
      }
    } else {
      code = fallback
    }
    // Domain and numeric code are useful for diagnosis and cannot reveal a path.
    return FlinkFilesException(
      code,
      operation: operation,
      diagnostic: "\(cocoaError.domain):\(cocoaError.code)"
    )
  }

  private static func codeFallbackPermission(
    _ fallback: FlinkFileErrorCode
  ) -> FlinkFileErrorCode {
    fallback == .providerUnavailable ? .importPermission : fallback
  }
}

internal struct FlinkDocumentReference: Equatable, Hashable, Sendable {
  let fileId: String
  let revision: String

  init(fileId: String, revision: String) {
    self.fileId = fileId
    self.revision = revision
  }

  init(_ record: FlinkDocumentRefRecord) throws {
    guard FlinkIdentifier.isValid(record.fileId), FlinkIdentifier.isValid(record.revision) else {
      throw FlinkFilesException(.invalidArgument, operation: "documentRef")
    }
    self.init(fileId: record.fileId, revision: record.revision)
  }

  var dictionary: [String: Any] {
    ["fileId": fileId, "revision": revision]
  }
}

internal enum FlinkLibraryEntryStatus: String, Sendable {
  case unknown
  case ready
  case locked
  case invalid
  case unavailable
}

internal struct FlinkIndexedDocument: Sendable {
  let reference: FlinkDocumentReference
  let name: String
  let relativePath: String
  let url: URL
  let sizeBytes: Int64
  let modifiedAtUnixMs: Double?
  let resourceIdentity: String?
  let identityKey: String
  let metadataFingerprint: String
  let status: FlinkLibraryEntryStatus

  var dictionary: [String: Any] {
    var value = reference.dictionary
    value["name"] = name
    value["relativePath"] = relativePath
    value["sizeBytes"] = Double(sizeBytes)
    value["modifiedAtUnixMs"] = modifiedAtUnixMs ?? NSNull()
    value["status"] = status.rawValue
    return value
  }
}

internal struct FlinkResolvedDocument: Sendable {
  let reference: FlinkDocumentReference
  let name: String
  let relativePath: String
  let url: URL
  let libraryRoot: URL
  let sizeBytes: Int64
  let modifiedAtUnixMs: Double?
  let resourceIdentity: String?
  let runtimeGeneration: UInt64?

  var dictionary: [String: Any] {
    reference.dictionary
  }

  func associated(withRuntimeGeneration generation: UInt64) -> FlinkResolvedDocument {
    FlinkResolvedDocument(
      reference: reference,
      name: name,
      relativePath: relativePath,
      url: url,
      libraryRoot: libraryRoot,
      sizeBytes: sizeBytes,
      modifiedAtUnixMs: modifiedAtUnixMs,
      resourceIdentity: resourceIdentity,
      runtimeGeneration: generation
    )
  }
}

internal struct FlinkLibraryWarning: Sendable {
  let code: String
  let relativePath: String?

  var dictionary: [String: Any] {
    var value: [String: Any] = ["code": code]
    if let relativePath {
      value["relativePath"] = relativePath
    }
    return value
  }
}

internal struct FlinkLibrarySnapshot: Sendable {
  let scanId: String
  let indexRevision: String
  let entries: [FlinkIndexedDocument]
  let warnings: [FlinkLibraryWarning]

  var dictionary: [String: Any] {
    [
      "scanId": scanId,
      "indexRevision": indexRevision,
      "entries": entries.map(\.dictionary),
      "warnings": warnings.map(\.dictionary),
    ]
  }
}

internal enum FlinkDocumentInvalidationReason: String, Sendable {
  case changed
  case missing
  case moved
  case writerRequested
}

internal struct FlinkFilesEventSink: @unchecked Sendable {
  let libraryInvalidated: @Sendable (_ reason: String, _ indexRevision: String?) -> Void
  let importProgress: @Sendable (_ progress: [String: Any]) -> Void
  let documentInvalidated: @Sendable (
    _ document: FlinkDocumentReference,
    _ reason: String
  ) -> Void
}

internal enum FlinkIdentifier {
  /// Bridge IDs are opaque, bounded tokens; paths and control characters are never valid IDs.
  static func isValid(_ value: String) -> Bool {
    guard !value.isEmpty, value.utf8.count <= 256 else {
      return false
    }
    guard !value.unicodeScalars.contains(where: { scalar in
      CharacterSet.controlCharacters.contains(scalar)
        || scalar == "/"
        || scalar == "\\"
    }) else {
      return false
    }
    if let decoded = value.removingPercentEncoding,
       decoded != value,
       (decoded.contains("/") || decoded.contains("\\")) {
      return false
    }
    return true
  }
}

internal enum FlinkHash {
  static func sha256(_ value: String) -> String {
    let digest = SHA256.hash(data: Data(value.utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
  }
}

internal enum FlinkResourceIdentity {
  static func hashed(_ value: Any?) -> String? {
    guard let value else { return nil }
    if let data = value as? Data {
      return FlinkHash.sha256("data|\(data.base64EncodedString())")
    }
    if let string = value as? String {
      return FlinkHash.sha256("string|\(string)")
    }
    if let number = value as? NSNumber {
      return FlinkHash.sha256("number|\(number.stringValue)")
    }
    if let object = value as? NSObject,
       let archive = try? NSKeyedArchiver.archivedData(
         withRootObject: object,
         requiringSecureCoding: false
       ) {
      return FlinkHash.sha256("archive|\(archive.base64EncodedString())")
    }
    return FlinkHash.sha256(
      "\(String(reflecting: type(of: value)))|\(String(describing: value))"
    )
  }
}

internal enum FlinkPathSafety {
  static func relativePath(of candidate: URL, within root: URL) throws -> String {
    let rootComponents = root.standardizedFileURL.pathComponents
    let candidateComponents = candidate.standardizedFileURL.pathComponents
    guard candidateComponents.count > rootComponents.count,
          Array(candidateComponents.prefix(rootComponents.count)) == rootComponents
    else {
      throw FlinkFilesException(.pathOutsideLibrary, operation: "relativePath")
    }

    let relativeComponents = candidateComponents.dropFirst(rootComponents.count)
    guard !relativeComponents.contains(".."), !relativeComponents.contains(".") else {
      throw FlinkFilesException(.pathOutsideLibrary, operation: "relativePath")
    }
    return relativeComponents.joined(separator: "/")
  }

  static func assertNoSymbolicLink(from root: URL, through candidate: URL) throws {
    let rootComponents = root.standardizedFileURL.pathComponents
    let candidateComponents = candidate.standardizedFileURL.pathComponents
    guard candidateComponents.count >= rootComponents.count,
          Array(candidateComponents.prefix(rootComponents.count)) == rootComponents
    else {
      throw FlinkFilesException(.pathOutsideLibrary, operation: "pathValidation")
    }
    // Validate only the app-owned root and descendants. System ancestors (for example
    // `/var` on Apple platforms) may themselves be symlinks and are outside our trust
    // boundary.
    var current = root.standardizedFileURL
    if try current.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
      throw FlinkFilesException(.pathOutsideLibrary, operation: "pathValidation")
    }

    for component in candidateComponents.dropFirst(rootComponents.count) {
      current.appendPathComponent(component)
      let values = try current.resourceValues(forKeys: [
        .isSymbolicLinkKey,
      ])
      if values.isSymbolicLink == true {
        throw FlinkFilesException(.pathOutsideLibrary, operation: "pathValidation")
      }
    }
  }

  static func contains(_ candidate: URL, within root: URL) -> Bool {
    (try? relativePath(of: candidate, within: root)) != nil
  }
}

internal extension NSLock {
  func flinkWithLock<T>(_ body: () throws -> T) rethrows -> T {
    lock()
    defer { unlock() }
    return try body()
  }
}
