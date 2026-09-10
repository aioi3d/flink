import Foundation

internal final class FlinkLibraryPresenter: NSObject, NSFilePresenter {
  internal var presentedItemURL: URL?
  internal let presentedItemOperationQueue: OperationQueue
  private let onChange: @Sendable (URL?) -> Void
  private let lock = NSLock()
  private var registered = false

  internal init(
    libraryURL: URL,
    onChange: @escaping @Sendable (URL?) -> Void
  ) {
    self.presentedItemURL = libraryURL
    self.onChange = onChange
    let queue = OperationQueue()
    queue.name = "com.aioi.flink.library-presenter"
    queue.maxConcurrentOperationCount = 1
    queue.qualityOfService = .utility
    self.presentedItemOperationQueue = queue
    super.init()
  }

  internal func start() {
    let shouldRegister = lock.flinkWithLock {
      guard !registered else { return false }
      registered = true
      return true
    }
    if shouldRegister {
      NSFileCoordinator.addFilePresenter(self)
    }
  }

  internal func close() {
    let shouldRemove = lock.flinkWithLock {
      guard registered else { return false }
      registered = false
      return true
    }
    if shouldRemove {
      NSFileCoordinator.removeFilePresenter(self)
    }
  }

  deinit {
    close()
  }

  internal func presentedItemDidChange() {
    onChange(presentedItemURL)
  }

  internal func presentedItemDidMove(to _: URL) {
    // The canonical root remains Documents/library; never follow it elsewhere.
    onChange(nil)
  }

  internal func accommodatePresentedItemDeletion(
    completionHandler: @escaping (Error?) -> Void
  ) {
    onChange(nil)
    completionHandler(nil)
  }

  internal func presentedSubitemDidAppear(at url: URL) {
    onChange(url)
  }

  internal func presentedSubitemDidChange(at url: URL) {
    onChange(url)
  }

  internal func presentedSubitem(at oldURL: URL, didMoveTo newURL: URL) {
    onChange(oldURL)
    onChange(newURL)
  }

  internal func accommodatePresentedSubitemDeletion(
    at url: URL,
    completionHandler: @escaping (Error?) -> Void
  ) {
    onChange(url)
    completionHandler(nil)
  }
}

internal final class FlinkActiveDocumentLease: NSObject, NSFilePresenter {
  internal var presentedItemURL: URL?
  internal let presentedItemOperationQueue: OperationQueue
  internal let document: FlinkDocumentReference

  private let onInvalidated: @Sendable (FlinkDocumentInvalidationReason) -> Void
  private let onRelinquishToWriter: (@Sendable (
    _ detached: @escaping @Sendable () -> Void
  ) -> Void)?
  private let onClose: @Sendable () -> Void
  private let lock = NSLock()
  private var registered = false

  internal init(
    document: FlinkDocumentReference,
    url: URL,
    onInvalidated: @escaping @Sendable (FlinkDocumentInvalidationReason) -> Void,
    onRelinquishToWriter: (@Sendable (
      _ detached: @escaping @Sendable () -> Void
    ) -> Void)?,
    onClose: @escaping @Sendable () -> Void
  ) {
    self.document = document
    self.presentedItemURL = url
    self.onRelinquishToWriter = onRelinquishToWriter
    self.onInvalidated = onInvalidated
    self.onClose = onClose
    let queue = OperationQueue()
    queue.name = "com.aioi.flink.active-document-presenter"
    queue.maxConcurrentOperationCount = 1
    queue.qualityOfService = .userInitiated
    self.presentedItemOperationQueue = queue
    super.init()
    registered = true
    NSFileCoordinator.addFilePresenter(self)
  }

  internal func close() {
    let shouldRemove = lock.flinkWithLock {
      guard registered else { return false }
      registered = false
      return true
    }
    if shouldRemove {
      NSFileCoordinator.removeFilePresenter(self)
      onClose()
    }
  }

  deinit {
    close()
  }

  internal func presentedItemDidChange() {
    onInvalidated(.changed)
  }

  internal func presentedItemDidMove(to newURL: URL) {
    presentedItemURL = newURL
    onInvalidated(.moved)
  }

  internal func accommodatePresentedItemDeletion(
    completionHandler: @escaping (Error?) -> Void
  ) {
    onInvalidated(.missing)
    completionHandler(nil)
  }

  internal func relinquishPresentedItem(
    toWriter writer: @escaping ((() -> Void)?) -> Void
  ) {
    onInvalidated(.writerRequested)
    guard let onRelinquishToWriter else {
      writer(nil)
      return
    }
    let once = FlinkOneShot {
      writer(nil)
    }
    onRelinquishToWriter {
      once.run()
    }
  }
}

private final class FlinkOneShot: @unchecked Sendable {
  private let lock = NSLock()
  private var action: (@Sendable () -> Void)?

  init(_ action: @escaping @Sendable () -> Void) {
    self.action = action
  }

  func run() {
    let action = lock.flinkWithLock {
      let current = self.action
      self.action = nil
      return current
    }
    action?()
  }
}
