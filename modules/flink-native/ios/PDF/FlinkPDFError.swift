import ExpoModulesCore
import Foundation

/// A PDF-reader failure whose bridge-visible text never contains a sandbox path
/// or document content. File-service errors are preserved by code separately.
internal final class FlinkPDFException: Exception {
  private let errorCode: String
  private let publicReason: String
  let operation: String
  let recoverable: Bool

  init(
    code: String,
    operation: String,
    recoverable: Bool,
    reason: String
  ) {
    self.errorCode = code
    self.operation = operation
    self.recoverable = recoverable
    self.publicReason = reason
    super.init()
  }

  override var code: String {
    errorCode
  }

  override var reason: String {
    publicReason
  }

  var wireValue: [String: Any] {
    [
      "code": errorCode,
      "operation": operation,
      "recoverable": recoverable
    ]
  }
}

internal enum FlinkPDFErrors {
  static func invalidInput(operation: String) -> FlinkPDFException {
    FlinkPDFException(
      code: "E_PDF_INVALID",
      operation: operation,
      recoverable: true,
      reason: "PDF reader received an invalid request"
    )
  }

  static func locked(operation: String = "openDocument") -> FlinkPDFException {
    FlinkPDFException(
      code: "E_PDF_LOCKED",
      operation: operation,
      recoverable: true,
      reason: "Password-protected PDFs are not supported"
    )
  }

  static func invalid(operation: String = "openDocument") -> FlinkPDFException {
    FlinkPDFException(
      code: "E_PDF_INVALID",
      operation: operation,
      recoverable: true,
      reason: "The PDF could not be read"
    )
  }

  static func empty(operation: String = "openDocument") -> FlinkPDFException {
    FlinkPDFException(
      code: "E_PDF_EMPTY",
      operation: operation,
      recoverable: true,
      reason: "The PDF contains no pages"
    )
  }

  static func missing(operation: String) -> FlinkPDFException {
    FlinkPDFException(
      code: "E_FILE_MISSING",
      operation: operation,
      recoverable: true,
      reason: "The document is no longer available"
    )
  }

  static func changed(operation: String) -> FlinkPDFException {
    FlinkPDFException(
      code: "E_FILE_CHANGED",
      operation: operation,
      recoverable: true,
      reason: "The document changed and must be selected again"
    )
  }

  /// An older open must reject instead of returning the newer document's
  /// snapshot. It intentionally emits no user-facing reader-error event.
  static func supersededOpen() -> FlinkPDFException {
    FlinkPDFException(
      code: "E_FILE_CHANGED",
      operation: "openDocument",
      recoverable: true,
      reason: "The open request was superseded"
    )
  }

  static func normalize(_ error: Error, operation: String) -> FlinkPDFException {
    if let error = error as? FlinkPDFException {
      return error
    }

    if let coded = error as? CodedError {
      let safeCodes: Set<String> = [
        "E_LIBRARY_PATH_BLOCKED",
        "E_LIBRARY_UNAVAILABLE",
        "E_PDF_LOCKED",
        "E_PDF_INVALID",
        "E_PDF_EMPTY",
        "E_FILE_MISSING",
        "E_FILE_CHANGED",
        "E_PATH_OUTSIDE_LIBRARY"
      ]
      let code = safeCodes.contains(coded.code) ? coded.code : "E_PDF_INVALID"
      return FlinkPDFException(
        code: code,
        operation: operation,
        recoverable: true,
        reason: safeReason(for: code)
      )
    }

    return invalid(operation: operation)
  }

  private static func safeReason(for code: String) -> String {
    switch code {
    case "E_PDF_LOCKED":
      return "Password-protected PDFs are not supported"
    case "E_PDF_EMPTY":
      return "The PDF contains no pages"
    case "E_FILE_MISSING":
      return "The document is no longer available"
    case "E_FILE_CHANGED":
      return "The document changed and must be selected again"
    case "E_PATH_OUTSIDE_LIBRARY":
      return "The document cannot be accessed"
    case "E_LIBRARY_PATH_BLOCKED", "E_LIBRARY_UNAVAILABLE":
      return "The library is unavailable"
    default:
      return "The PDF could not be read"
    }
  }
}
