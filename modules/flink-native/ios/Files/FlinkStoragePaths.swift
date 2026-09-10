import Foundation

internal struct FlinkStoragePaths: Sendable {
  let documents: URL
  let library: URL
  let applicationSupportRoot: URL
  let importStaging: URL
  let cacheRoot: URL
  let thumbnails: URL

  internal static func resolve(fileManager: FileManager = .default) throws -> FlinkStoragePaths {
    do {
      let documents = try fileManager.url(
        for: .documentDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let applicationSupport = try fileManager.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let caches = try fileManager.url(
        for: .cachesDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let applicationSupportRoot = applicationSupport
        .appendingPathComponent("Flink", isDirectory: true)
      let cacheRoot = caches.appendingPathComponent("Flink", isDirectory: true)
      return FlinkStoragePaths(
        documents: documents,
        library: documents.appendingPathComponent("library", isDirectory: true),
        applicationSupportRoot: applicationSupportRoot,
        importStaging: applicationSupportRoot
          .appendingPathComponent("import-staging", isDirectory: true),
        cacheRoot: cacheRoot,
        thumbnails: cacheRoot.appendingPathComponent("thumbnails", isDirectory: true)
      )
    } catch {
      throw FlinkFilesException.wrapping(
        error,
        operation: "resolveStoragePaths",
        fallback: .libraryUnavailable
      )
    }
  }

  internal func ensureDirectories(
    cleanupStaging: Bool,
    fileManager: FileManager = .default
  ) throws {
    try ensureDirectory(library, publicLibrary: true, fileManager: fileManager)
    try ensureDirectory(applicationSupportRoot, publicLibrary: false, fileManager: fileManager)
    try ensureDirectory(importStaging, publicLibrary: false, fileManager: fileManager)
    try ensureDirectory(cacheRoot, publicLibrary: false, fileManager: fileManager)
    try ensureDirectory(thumbnails, publicLibrary: false, fileManager: fileManager)

    if cleanupStaging {
      try cleanupOwnedStaging(fileManager: fileManager)
    }
  }

  private func ensureDirectory(
    _ url: URL,
    publicLibrary: Bool,
    fileManager: FileManager
  ) throws {
    do {
      var isDirectory: ObjCBool = false
      if fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) {
        let values = try url.resourceValues(forKeys: [
          .isDirectoryKey,
          .isSymbolicLinkKey,
        ])
        guard isDirectory.boolValue,
              values.isDirectory == true,
              values.isSymbolicLink != true
        else {
          throw FlinkFilesException(
            publicLibrary ? .libraryPathBlocked : .libraryUnavailable,
            operation: "initializeStorage"
          )
        }
        return
      }

      try fileManager.createDirectory(
        at: url,
        withIntermediateDirectories: true,
        attributes: publicLibrary ? nil : [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
      let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
      guard values.isDirectory == true, values.isSymbolicLink != true else {
        throw FlinkFilesException(
          publicLibrary ? .libraryPathBlocked : .libraryUnavailable,
          operation: "initializeStorage"
        )
      }
    } catch {
      if let flinkError = error as? FlinkFilesException {
        throw flinkError
      }
      throw FlinkFilesException.wrapping(
        error,
        operation: "initializeStorage",
        fallback: publicLibrary ? .libraryPathBlocked : .libraryUnavailable
      )
    }
  }

  private func cleanupOwnedStaging(fileManager: FileManager) throws {
    do {
      let contents = try fileManager.contentsOfDirectory(
        at: importStaging,
        includingPropertiesForKeys: [.isRegularFileKey, .isDirectoryKey, .isSymbolicLinkKey],
        options: []
      )
      // This directory is private and wholly owned by Flink. Never clean Documents/library.
      for url in contents {
        try fileManager.removeItem(at: url)
      }
    } catch {
      throw FlinkFilesException.wrapping(
        error,
        operation: "cleanupImportStaging",
        fallback: .libraryUnavailable
      )
    }
  }
}
