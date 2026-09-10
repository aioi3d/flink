import Foundation

internal enum FlinkNativeBuildInfo {
  static let nativeApiVersion = 2

  static var nativeRuntimeVersion: String {
    stringValue(forInfoKey: "FlinkNativeRuntimeVersion") ?? "1.0.11"
  }

  static var nativeRuntimeSignature: String {
    stringValue(forInfoKey: "FlinkNativeRuntimeSignature") ?? "unresolved"
  }

  static var sourceCommit: String? {
    stringValue(forInfoKey: "FlinkNativeSourceCommit")
  }

  static var buildProfile: String {
    if let embedded = stringValue(forInfoKey: "FlinkNativeBuildProfile"),
       embedded == "development" || embedded == "production" {
      return embedded
    }
    #if DEBUG
    return "development"
    #else
    return "production"
    #endif
  }

  static var dictionary: [String: Any] {
    [
      "nativeApiVersion": nativeApiVersion,
      "nativeRuntimeVersion": nativeRuntimeVersion,
      "nativeRuntimeSignature": nativeRuntimeSignature,
      "buildProfile": buildProfile,
      "sourceCommit": sourceCommit ?? NSNull()
    ]
  }

  private static func stringValue(forInfoKey key: String) -> String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
      return nil
    }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return normalized.isEmpty ? nil : normalized
  }
}
