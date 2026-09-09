import ExpoModulesCore

/// Phase 1 binds the complete API surface but must not pretend Phase 2 work ran.
internal final class FlinkNotImplementedException: Exception {
  private let operation: String

  init(operation: String) {
    self.operation = operation
    super.init()
  }

  override var code: String {
    "NOT_IMPLEMENTED"
  }

  override var reason: String {
    "\(operation) is declared by native API v1 and will be implemented in Phase 2"
  }
}
