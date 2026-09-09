import ExpoModulesCore

public final class FlinkNativeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FlinkNative")

    Constant("nativeApiVersion") {
      FlinkNativeBuildInfo.nativeApiVersion
    }
    Constant("nativeRuntimeVersion") {
      FlinkNativeBuildInfo.nativeRuntimeVersion
    }
    Constant("nativeRuntimeSignature") {
      FlinkNativeBuildInfo.nativeRuntimeSignature
    }

    Events(
      "onLibraryInvalidated",
      "onImportProgress",
      "onDocumentInvalidated"
    )

    AsyncFunction("getRuntimeInfo") { () -> [String: Any] in
      FlinkNativeBuildInfo.dictionary
    }

    AsyncFunction("initializeLibrary") { () throws -> Void in
      throw FlinkNotImplementedException(operation: "initializeLibrary")
    }
    AsyncFunction("scanLibrary") { () throws -> [String: Any] in
      throw FlinkNotImplementedException(operation: "scanLibrary")
    }
    AsyncFunction("presentImportPicker") { (_: String) throws -> [String: Any] in
      throw FlinkNotImplementedException(operation: "presentImportPicker")
    }
    AsyncFunction("cancelImport") { (_: String) throws -> Void in
      throw FlinkNotImplementedException(operation: "cancelImport")
    }
    AsyncFunction("renameDocument") {
      (_: FlinkDocumentRefRecord, _: String) throws -> [String: Any] in
      throw FlinkNotImplementedException(operation: "renameDocument")
    }
    AsyncFunction("deleteDocument") {
      (_: FlinkDocumentRefRecord) throws -> Void in
      throw FlinkNotImplementedException(operation: "deleteDocument")
    }
    AsyncFunction("requestThumbnail") {
      (_: FlinkDocumentRefRecord, _: String) throws -> [String: Any] in
      throw FlinkNotImplementedException(operation: "requestThumbnail")
    }
    AsyncFunction("cancelThumbnail") { (_: String) throws -> Void in
      throw FlinkNotImplementedException(operation: "cancelThumbnail")
    }

    AsyncFunction("getCapabilities") { () throws -> [String: Any] in
      throw FlinkNotImplementedException(operation: "getCapabilities")
    }
    AsyncFunction("requestCameraPermission") { () throws -> String in
      throw FlinkNotImplementedException(operation: "requestCameraPermission")
    }
    AsyncFunction("startTracking") {
      (_: FlinkInputContextRecord) throws -> [String: Any] in
      throw FlinkNotImplementedException(operation: "startTracking")
    }
    AsyncFunction("stopTracking") {
      (_: FlinkInputContextRecord, _: String) throws -> Void in
      throw FlinkNotImplementedException(operation: "stopTracking")
    }
    AsyncFunction("resetInput") {
      (_: FlinkInputContextRecord) throws -> [String: Any] in
      throw FlinkNotImplementedException(operation: "resetInput")
    }
    AsyncFunction("drainSamples") { (_: String) throws -> [String: Any] in
      throw FlinkNotImplementedException(operation: "drainSamples")
    }

    View(FlinkPDFView.self) {
      Events(
        "onReaderStateChanged",
        "onPageChanged",
        "onReaderError"
      )

      AsyncFunction("openDocument") {
        (_: FlinkPDFView, _: FlinkOpenDocumentInputRecord) throws -> [String: Any] in
        throw FlinkNotImplementedException(operation: "openDocument")
      }
      AsyncFunction("navigate") {
        (_: FlinkPDFView, _: FlinkNavigateRequestRecord) throws -> [String: Any] in
        throw FlinkNotImplementedException(operation: "navigate")
      }
      AsyncFunction("fitCurrentPage") {
        (_: FlinkPDFView, _: String) throws -> [String: Any] in
        throw FlinkNotImplementedException(operation: "fitCurrentPage")
      }
      AsyncFunction("closeDocument") {
        (_: FlinkPDFView, _: String) throws -> Void in
        throw FlinkNotImplementedException(operation: "closeDocument")
      }
    }
  }
}
