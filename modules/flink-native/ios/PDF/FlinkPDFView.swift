import ExpoModulesCore
import PDFKit
import UIKit

/// PDFKit-backed, one-page reader. File URLs are never accepted from JS: every
/// open resolves a current DocumentRef through FlinkFilesRuntime first.
@MainActor
internal final class FlinkPDFView: ExpoView {
  let onViewReady = EventDispatcher()
  let onReaderStateChanged = EventDispatcher()
  let onPageChanged = EventDispatcher()
  let onReaderError = EventDispatcher()

  private let pdfView = PDFView(frame: .zero)
  private let documentLoader = FlinkPDFDocumentLoader()

  private var openGeneration: UInt64 = 0
  private var stateRevision = 0
  private var activeOpenRequestId: String?
  private var activeSnapshot: FlinkPDFSnapshot?
  private var activeDocumentLease: FlinkActiveDocumentLease?
  private var recentCommandIds = FlinkPDFRecentCommandIds()
  private var navigationInProgress = false
  private var ignorePageChangeNotification = false
  private var documentIsValid = false
  private var lifecycleIsSuspended = false
  private var didEmitViewReady = false
  private var lastLayoutSize = CGSize.zero
  private var loadTickets: [UInt64: FlinkPDFLoadTicket] = [:]
  private var openAbortErrors: [UInt64: FlinkPDFException] = [:]

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .clear
    clipsToBounds = true
    isAccessibilityElement = false

    configurePDFView()
    addSubview(pdfView)
    installObservers()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    for ticket in loadTickets.values {
      ticket.cancel()
    }
    if let readerSessionId = activeSnapshot?.readerSessionId {
      FaceSessionCoordinator.shared.stopForReaderTermination(
        readerSessionId: readerSessionId
      )
      FlinkReaderContextBroker.shared.closeReader(sessionId: readerSessionId)
    }
    // PDFKit may retain lazy access to the file. Detach it before unregistering
    // the active presenter so a writer never observes a released lease first.
    pdfView.document = nil
    activeDocumentLease?.close()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    pdfView.frame = bounds

    let nextSize = bounds.size
    guard nextSize.width > 0,
          nextSize.height > 0,
          nextSize != lastLayoutSize else {
      return
    }
    lastLayoutSize = nextSize

    // Wait until PDFView has consumed the new bounds. The session check avoids
    // fitting a replacement document after a rapid selection change.
    guard let expectedSessionId = activeSnapshot?.readerSessionId,
          pdfView.document != nil else {
      return
    }
    DispatchQueue.main.async { [weak self] in
      guard let self,
            self.activeSnapshot?.readerSessionId == expectedSessionId,
            self.pdfView.document != nil else {
        return
      }
      self.fitDisplayedPage()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, !didEmitViewReady {
      didEmitViewReady = true
      onViewReady(["ready": true])
    }
    guard activeSnapshot != nil else {
      return
    }
    guard window != nil else {
      suspendForLifecycle(stopTracking: true)
      return
    }
    if interactionEnvironmentIsActive {
      resumeAfterLifecycleIfPossible()
    } else {
      suspendForLifecycle(stopTracking: true)
    }
  }

  func openDocument(_ input: FlinkOpenDocumentInputRecord) async throws -> [String: Any] {
    let operation = "openDocument"
    guard isValidIdentifier(input.openRequestId),
          isValidDocumentReference(input.document) else {
      throw FlinkPDFErrors.invalidInput(operation: operation)
    }

    let generation = beginOpen(input: input)
    let readerSessionId = UUID().uuidString.lowercased()
    var pendingLease: FlinkActiveDocumentLease?

    do {
      let resolved = try await FlinkFilesRuntime.shared.resolveDocument(
        input.document,
        operation: operation
      )
      try ensureCurrentOpen(generation: generation, openRequestId: input.openRequestId)

      let lease = try FlinkFilesRuntime.shared.makeActiveDocumentLease(
        for: resolved,
        onInvalidated: { [weak self] reason in
          Task { @MainActor [weak self] in
            self?.handleDocumentInvalidation(
              reason,
              readerSessionId: readerSessionId,
              generation: generation
            )
          }
        },
        onRelinquishToWriter: { [weak self] completion in
          let oneShot = FlinkPDFOneShotCompletion(completion)
          Task { @MainActor [weak self] in
            guard let self else {
              oneShot.call()
              return
            }
            self.handleWriterRelinquish(
              readerSessionId: readerSessionId,
              generation: generation,
              completion: oneShot
            )
          }
        }
      )
      pendingLease = lease
      try ensureCurrentOpen(generation: generation, openRequestId: input.openRequestId)

      let loadTicket = FlinkPDFLoadTicket()
      loadTickets[generation] = loadTicket
      let loaded = try await documentLoader.load(
        url: resolved.url,
        ticket: loadTicket
      )
      loadTickets.removeValue(forKey: generation)
      try ensureCurrentOpen(generation: generation, openRequestId: input.openRequestId)

      activeDocumentLease = lease
      pendingLease = nil
      attach(
        loaded: loaded,
        document: input.document,
        readerSessionId: readerSessionId
      )

      guard let snapshot = activeSnapshot else {
        throw FlinkPDFErrors.invalid(operation: operation)
      }
      return snapshot.wireValue
    } catch {
      loadTickets.removeValue(forKey: generation)
      pendingLease?.close()
      let abortError = openAbortErrors.removeValue(forKey: generation)
      let normalized = FlinkPDFErrors.normalize(error, operation: operation)

      guard isCurrentOpen(generation: generation, openRequestId: input.openRequestId) else {
        throw abortError ?? FlinkPDFErrors.supersededOpen()
      }

      failOpen(
        error: normalized,
        document: input.document,
        readerSessionId: readerSessionId
      )
      throw normalized
    }
  }

  func navigate(_ request: FlinkNavigateRequestRecord) throws -> [String: Any] {
    let operation = "navigate"
    guard isValidIdentifier(request.readerSessionId),
          isValidIdentifier(request.commandId),
          let source = FlinkPDFNavigationSource(rawValue: request.source),
          let requestedPage = requestedPageIndex(for: request, source: source) else {
      throw FlinkPDFErrors.invalidInput(operation: operation)
    }

    guard let snapshot = activeSnapshot else {
      throw FlinkPDFErrors.invalidInput(operation: operation)
    }

    if !recentCommandIds.insert(request.commandId) {
      return navigationResult(
        commandId: request.commandId,
        disposition: .duplicate,
        snapshot: snapshot
      )
    }

    guard request.readerSessionId == snapshot.readerSessionId else {
      return navigationResult(
        commandId: request.commandId,
        disposition: .stale,
        snapshot: snapshot
      )
    }

    guard pdfView.document != nil,
          snapshot.state != .closed,
          snapshot.state != .error else {
      return navigationResult(
        commandId: request.commandId,
        disposition: .suspended,
        snapshot: snapshot
      )
    }

    if navigationInProgress || snapshot.state == .navigating {
      return navigationResult(
        commandId: request.commandId,
        disposition: .busy,
        snapshot: snapshot
      )
    }

    guard documentIsValid,
          !lifecycleIsSuspended,
          snapshot.state == .ready else {
      return navigationResult(
        commandId: request.commandId,
        disposition: .suspended,
        snapshot: snapshot
      )
    }

    if source == .manual {
      switch FlinkReaderContextBroker.shared.authorizeManual(
        readerSessionId: request.readerSessionId
      ) {
      case .allowed:
        break
      case .stale:
        return navigationResult(
          commandId: request.commandId,
          disposition: .stale,
          snapshot: snapshot
        )
      case .suspended:
        return navigationResult(
          commandId: request.commandId,
          disposition: .suspended,
          snapshot: snapshot
        )
      }
    } else {
      let nowMs = Self.nativeNowMs
      guard let sampleNativeMs = request.sampleNativeMs,
            sampleNativeMs.isFinite,
            sampleNativeMs <= nowMs,
            nowMs - sampleNativeMs <= 350 else {
        return navigationResult(
          commandId: request.commandId,
          disposition: .stale,
          snapshot: snapshot
        )
      }

      switch FlinkReaderContextBroker.shared.authorizeBlink(
        request,
        nativeNowMs: nowMs
      ) {
      case .allowed:
        break
      case .stale:
        return navigationResult(
          commandId: request.commandId,
          disposition: .stale,
          snapshot: snapshot
        )
      case .suspended:
        return navigationResult(
          commandId: request.commandId,
          disposition: .suspended,
          snapshot: snapshot
        )
      }
    }

    guard requestedPage >= 0, requestedPage < snapshot.pageCount else {
      return navigationResult(
        commandId: request.commandId,
        disposition: .boundary,
        snapshot: snapshot
      )
    }

    return try applyNavigation(
      commandId: request.commandId,
      pageIndex: requestedPage,
      operation: operation
    ).wireValue
  }

  /// A stale cleanup is intentionally a no-op so an old React ref cannot close
  /// the document that replaced it.
  func closeDocument(_ readerSessionId: String) {
    guard let snapshot = activeSnapshot,
          snapshot.readerSessionId == readerSessionId else {
      return
    }

    openGeneration &+= 1
    activeOpenRequestId = nil
    documentIsValid = false
    navigationInProgress = false

    let closedSnapshot = makeSnapshot(
      readerSessionId: snapshot.readerSessionId,
      document: snapshot.document,
      pageIndex: snapshot.pageIndex,
      pageCount: snapshot.pageCount,
      state: .closed
    )
    activeSnapshot = closedSnapshot
    detachDocumentAndReleaseLease()
    FaceSessionCoordinator.shared.stopForReaderTermination(
      readerSessionId: readerSessionId
    )
    FlinkReaderContextBroker.shared.closeReader(sessionId: readerSessionId)
    emitStateChanged(closedSnapshot)
  }

  // MARK: - PDF setup and state

  private func configurePDFView() {
    pdfView.translatesAutoresizingMaskIntoConstraints = true
    pdfView.backgroundColor = .clear
    pdfView.displayMode = .singlePage
    pdfView.displayDirection = .horizontal
    pdfView.displaysAsBook = false
    pdfView.displaysRTL = false
    pdfView.usePageViewController(false, withViewOptions: nil)
    pdfView.autoScales = true
    pdfView.isUserInteractionEnabled = true
    pdfView.accessibilityLabel = "PDFビューア"
    pdfView.accessibilityIdentifier = "flink-pdf-view"
  }

  private func installObservers() {
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(pdfPageChanged(_:)),
      name: .PDFViewPageChanged,
      object: pdfView
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationWillResignActive),
      name: UIApplication.willResignActiveNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationDidEnterBackground),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(applicationDidBecomeActive),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(sceneWillDeactivate(_:)),
      name: UIScene.willDeactivateNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(sceneDidEnterBackground(_:)),
      name: UIScene.didEnterBackgroundNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(sceneDidActivate(_:)),
      name: UIScene.didActivateNotification,
      object: nil
    )
  }

  private func beginOpen(input: FlinkOpenDocumentInputRecord) -> UInt64 {
    openGeneration &+= 1
    activeOpenRequestId = input.openRequestId
    recentCommandIds.removeAll()
    navigationInProgress = false
    documentIsValid = false

    for ticket in loadTickets.values {
      ticket.cancel()
    }

    if let oldSessionId = activeSnapshot?.readerSessionId {
      FaceSessionCoordinator.shared.stopForReaderTermination(
        readerSessionId: oldSessionId
      )
      FlinkReaderContextBroker.shared.closeReader(sessionId: oldSessionId)
    }
    detachDocumentAndReleaseLease()
    activeSnapshot = nil
    return openGeneration
  }

  private func attach(
    loaded: FlinkLoadedPDFDocument,
    document: FlinkDocumentRefRecord,
    readerSessionId: String
  ) {
    ignorePageChangeNotification = true
    pdfView.document = loaded.document
    if let firstPage = loaded.document.page(at: 0) {
      disableExternalActions(on: firstPage)
      pdfView.go(to: firstPage)
    }
    pdfView.layoutDocumentView()
    fitDisplayedPage()
    ignorePageChangeNotification = false

    documentIsValid = true
    lifecycleIsSuspended = !interactionEnvironmentIsActive
    let snapshot = makeSnapshot(
      readerSessionId: readerSessionId,
      document: document,
      pageIndex: 0,
      pageCount: loaded.pageCount,
      state: lifecycleIsSuspended ? .suspended : .ready
    )
    activeSnapshot = snapshot
    // Establish the native authorization context before publishing `ready`.
    // A JS listener may react to the event by starting tracking immediately.
    FlinkReaderContextBroker.shared.activateReader(
      sessionId: readerSessionId,
      document: document
    )
    if lifecycleIsSuspended {
      FlinkReaderContextBroker.shared.setInteractionSuspended(
        true,
        readerSessionId: readerSessionId
      )
    }
    emitStateChanged(snapshot)
    emitPageChanged(snapshot)
  }

  private func failOpen(
    error: FlinkPDFException,
    document: FlinkDocumentRefRecord,
    readerSessionId: String
  ) {
    openGeneration &+= 1
    activeOpenRequestId = nil
    documentIsValid = false
    detachDocumentAndReleaseLease()
    FaceSessionCoordinator.shared.stopForReaderTermination(
      readerSessionId: readerSessionId
    )
    FlinkReaderContextBroker.shared.closeReader(sessionId: readerSessionId)
    stateRevision += 1
    emitReaderError(
      error: error,
      readerSessionId: readerSessionId,
      stateRevision: stateRevision
    )
  }

  private func applyNavigation(
    commandId: String,
    pageIndex: Int,
    operation: String
  ) throws -> FlinkPDFNavigateResult {
    guard let snapshot = activeSnapshot,
          let document = pdfView.document else {
      throw FlinkPDFErrors.invalid(operation: operation)
    }
    guard let page = document.page(at: pageIndex) else {
      let error = FlinkPDFErrors.invalid(operation: operation)
      terminateForInvalidDocument(
        error: error,
        readerSessionId: snapshot.readerSessionId
      )
      throw error
    }

    navigationInProgress = true
    let navigating = makeSnapshot(
      readerSessionId: snapshot.readerSessionId,
      document: snapshot.document,
      pageIndex: snapshot.pageIndex,
      pageCount: snapshot.pageCount,
      state: .navigating
    )
    activeSnapshot = navigating
    emitStateChanged(navigating)

    ignorePageChangeNotification = true
    disableExternalActions(on: page)
    pdfView.go(to: page)
    pdfView.layoutDocumentView()
    fitDisplayedPage()
    ignorePageChangeNotification = false

    guard let currentPage = pdfView.currentPage,
          document.index(for: currentPage) == pageIndex else {
      navigationInProgress = false
      let error = FlinkPDFErrors.invalid(operation: operation)
      terminateForInvalidDocument(
        error: error,
        readerSessionId: snapshot.readerSessionId
      )
      throw error
    }

    let applied = makeSnapshot(
      readerSessionId: snapshot.readerSessionId,
      document: snapshot.document,
      pageIndex: pageIndex,
      pageCount: snapshot.pageCount,
      state: lifecycleIsSuspended ? .suspended : .ready
    )
    activeSnapshot = applied
    emitPageChanged(applied)
    emitStateChanged(applied)

    // Keep the command lane occupied through the next main-queue turn. Calls
    // that were already queued concurrently with this one are consumed as
    // `busy` instead of applying a second page change immediately afterward.
    let appliedSessionId = applied.readerSessionId
    DispatchQueue.main.async { [weak self] in
      guard let self,
            self.activeSnapshot?.readerSessionId == appliedSessionId else {
        return
      }
      self.navigationInProgress = false
    }
    return FlinkPDFNavigateResult(
      commandId: commandId,
      result: .applied,
      snapshot: applied
    )
  }

  private func fitDisplayedPage() {
    guard pdfView.document != nil,
          pdfView.currentPage != nil,
          bounds.width > 0,
          bounds.height > 0 else {
      return
    }

    pdfView.layoutDocumentView()
    let fit = pdfView.scaleFactorForSizeToFit
    guard fit.isFinite, fit > 0 else {
      return
    }

    pdfView.autoScales = false
    pdfView.minScaleFactor = fit
    pdfView.maxScaleFactor = max(fit * 8, fit)
    pdfView.scaleFactor = fit
  }

  /// Only same-document go-to actions are meaningful in this read-only view.
  /// Removing every other annotation action blocks URL/remote-document launch,
  /// named actions such as print, and form reset without touching the file. The
  /// scan stays page-local so opening a 10,000-page document remains bounded.
  private func disableExternalActions(on page: PDFPage) {
    for annotation in page.annotations {
      if let action = annotation.action,
         !(action is PDFActionGoTo) {
        annotation.action = nil
      }
    }
  }

  private func detachDocumentAndReleaseLease() {
    ignorePageChangeNotification = true
    pdfView.document = nil
    ignorePageChangeNotification = false

    let lease = activeDocumentLease
    activeDocumentLease = nil
    lease?.close()
  }

  // MARK: - Navigation validation

  private func requestedPageIndex(
    for request: FlinkNavigateRequestRecord,
    source: FlinkPDFNavigationSource
  ) -> Int? {
    guard let snapshot = activeSnapshot else {
      return nil
    }

    let delta = request.move.delta
    let pageIndex = request.move.pageIndex
    switch source {
    case .manual:
      guard request.inputContext == nil,
            request.trackingEpoch == nil,
            request.sampleNativeMs == nil else {
        return nil
      }
      if let delta, pageIndex == nil, (delta == -1 || delta == 1) {
        let (candidate, overflow) = snapshot.pageIndex.addingReportingOverflow(delta)
        return overflow ? nil : candidate
      }
      if let pageIndex, delta == nil {
        return pageIndex
      }
      return nil
    case .blink:
      guard let inputContext = request.inputContext else {
        return nil
      }
      guard delta == 1,
            pageIndex == nil,
            isValidIdentifier(inputContext.jsRuntimeId),
            isValidIdentifier(inputContext.readerSessionId),
            isValidIdentifier(inputContext.generation),
            isValidIdentifier(request.trackingEpoch ?? ""),
            request.sampleNativeMs != nil else {
        return nil
      }
      let (candidate, overflow) = snapshot.pageIndex.addingReportingOverflow(1)
      return overflow ? nil : candidate
    }
  }

  private func navigationResult(
    commandId: String,
    disposition: FlinkPDFNavigateDisposition,
    snapshot: FlinkPDFSnapshot
  ) -> [String: Any] {
    FlinkPDFNavigateResult(
      commandId: commandId,
      result: disposition,
      snapshot: snapshot
    ).wireValue
  }

  // MARK: - Notifications and invalidation

  @objc private func pdfPageChanged(_ notification: Notification) {
    guard !ignorePageChangeNotification,
          !navigationInProgress,
          let snapshot = activeSnapshot,
          let document = pdfView.document,
          let currentPage = pdfView.currentPage else {
      return
    }

    let pageIndex = document.index(for: currentPage)
    guard pageIndex >= 0,
          pageIndex < snapshot.pageCount,
          pageIndex != snapshot.pageIndex else {
      return
    }

    disableExternalActions(on: currentPage)
    let updated = makeSnapshot(
      readerSessionId: snapshot.readerSessionId,
      document: snapshot.document,
      pageIndex: pageIndex,
      pageCount: snapshot.pageCount,
      state: lifecycleIsSuspended ? .suspended : .ready
    )
    activeSnapshot = updated
    fitDisplayedPage()
    emitPageChanged(updated)
    emitStateChanged(updated)
  }

  @objc private func applicationWillResignActive() {
    suspendForLifecycle()
  }

  @objc private func applicationDidEnterBackground() {
    suspendForLifecycle()
  }

  @objc private func applicationDidBecomeActive() {
    resumeAfterLifecycleIfPossible()
  }

  @objc private func sceneWillDeactivate(_ notification: Notification) {
    guard notificationAffectsCurrentScene(notification) else {
      return
    }
    suspendForLifecycle(stopTracking: true)
  }

  @objc private func sceneDidEnterBackground(_ notification: Notification) {
    guard notificationAffectsCurrentScene(notification) else {
      return
    }
    suspendForLifecycle(stopTracking: true)
  }

  @objc private func sceneDidActivate(_ notification: Notification) {
    guard notificationAffectsCurrentScene(notification) else {
      return
    }
    resumeAfterLifecycleIfPossible()
  }

  private func resumeAfterLifecycleIfPossible() {
    guard lifecycleIsSuspended,
          interactionEnvironmentIsActive,
          documentIsValid,
          let snapshot = activeSnapshot,
          snapshot.state == .suspended,
          pdfView.document != nil else {
      return
    }

    lifecycleIsSuspended = false
    FlinkReaderContextBroker.shared.setInteractionSuspended(
      false,
      readerSessionId: snapshot.readerSessionId
    )
    fitDisplayedPage()
    let ready = makeSnapshot(
      readerSessionId: snapshot.readerSessionId,
      document: snapshot.document,
      pageIndex: snapshot.pageIndex,
      pageCount: snapshot.pageCount,
      state: .ready
    )
    activeSnapshot = ready
    emitStateChanged(ready)
  }

  private func suspendForLifecycle(stopTracking: Bool = false) {
    if let readerSessionId = activeSnapshot?.readerSessionId {
      FlinkReaderContextBroker.shared.setInteractionSuspended(
        true,
        readerSessionId: readerSessionId
      )
      if stopTracking {
        FaceSessionCoordinator.shared.stopForReaderTermination(
          readerSessionId: readerSessionId
        )
      }
    }
    guard !lifecycleIsSuspended else {
      return
    }
    lifecycleIsSuspended = true

    guard let snapshot = activeSnapshot,
          documentIsValid,
          snapshot.state == .ready || snapshot.state == .navigating else {
      return
    }
    navigationInProgress = false
    let suspended = makeSnapshot(
      readerSessionId: snapshot.readerSessionId,
      document: snapshot.document,
      pageIndex: snapshot.pageIndex,
      pageCount: snapshot.pageCount,
      state: .suspended
    )
    activeSnapshot = suspended
    emitStateChanged(suspended)
  }

  private var interactionEnvironmentIsActive: Bool {
    guard UIApplication.shared.applicationState == .active else {
      return false
    }
    guard let scene = window?.windowScene else {
      return true
    }
    return scene.activationState == .foregroundActive
  }

  private func notificationAffectsCurrentScene(_ notification: Notification) -> Bool {
    guard let notifyingScene = notification.object as? UIScene,
          let currentScene = window?.windowScene else {
      return false
    }
    return notifyingScene === currentScene
  }

  private func handleDocumentInvalidation(
    _ reason: FlinkDocumentInvalidationReason,
    readerSessionId: String,
    generation: UInt64
  ) {
    guard generation == openGeneration else {
      return
    }

    switch reason {
    case .missing, .moved:
      let error = FlinkPDFErrors.missing(operation: "openDocument")
      if loadTickets[generation] != nil {
        openAbortErrors[generation] = error
      }
      loadTickets[generation]?.cancel()
      terminateForInvalidDocument(
        error: error,
        readerSessionId: readerSessionId
      )
    case .changed:
      let error = FlinkPDFErrors.changed(operation: "openDocument")
      if loadTickets[generation] != nil {
        openAbortErrors[generation] = error
      }
      loadTickets[generation]?.cancel()
      terminateForInvalidDocument(
        error: error,
        readerSessionId: readerSessionId
      )
    case .writerRequested:
      // The relinquish callback owns writer coordination and calls its
      // completion only after the PDF loader or attached PDFView lets go.
      break
    }
  }

  private func handleWriterRelinquish(
    readerSessionId: String,
    generation: UInt64,
    completion: FlinkPDFOneShotCompletion
  ) {
    if let loadTicket = loadTickets[generation] {
      loadTicket.cancel()
      if generation == openGeneration {
        let error = FlinkPDFErrors.changed(operation: "openDocument")
        openAbortErrors[generation] = error
        terminateForInvalidDocument(
          error: error,
          readerSessionId: readerSessionId
        )
      }

      // Nothing is attached to PDFView yet. The loader's NSFileCoordinator
      // read accessor remains the authoritative gate: an external coordinated
      // writer cannot enter until that accessor returns. Signalling here avoids
      // a writer/read coordination cycle; the cancelled result can never attach.
      completion.call()
      return
    }

    defer {
      completion.call()
    }
    guard generation == openGeneration else {
      return
    }
    terminateForInvalidDocument(
      error: FlinkPDFErrors.changed(operation: "openDocument"),
      readerSessionId: readerSessionId
    )
  }

  private func terminateForInvalidDocument(
    error: FlinkPDFException,
    readerSessionId: String
  ) {
    guard let snapshot = activeSnapshot,
          snapshot.readerSessionId == readerSessionId else {
      // The presenter may invalidate while its PDF is still loading. Bump the
      // token so that the eventual parse result is discarded.
      openGeneration &+= 1
      activeOpenRequestId = nil
      emitReaderError(
        error: error,
        readerSessionId: readerSessionId,
        stateRevision: nextStateRevision()
      )
      return
    }

    openGeneration &+= 1
    activeOpenRequestId = nil
    documentIsValid = false
    navigationInProgress = false
    let failed = makeSnapshot(
      readerSessionId: snapshot.readerSessionId,
      document: snapshot.document,
      pageIndex: snapshot.pageIndex,
      pageCount: snapshot.pageCount,
      state: .error
    )
    activeSnapshot = failed

    // Detach PDFKit before allowing a coordinated writer to proceed.
    detachDocumentAndReleaseLease()
    FaceSessionCoordinator.shared.stopForReaderTermination(
      readerSessionId: readerSessionId
    )
    FlinkReaderContextBroker.shared.closeReader(sessionId: readerSessionId)
    emitStateChanged(failed)
    emitReaderError(
      error: error,
      readerSessionId: readerSessionId,
      stateRevision: failed.stateRevision
    )
  }

  // MARK: - Wire events

  private func makeSnapshot(
    readerSessionId: String,
    document: FlinkDocumentRefRecord,
    pageIndex: Int,
    pageCount: Int,
    state: FlinkPDFReaderState
  ) -> FlinkPDFSnapshot {
    FlinkPDFSnapshot(
      readerSessionId: readerSessionId,
      document: document,
      pageIndex: pageIndex,
      pageCount: pageCount,
      stateRevision: nextStateRevision(),
      state: state
    )
  }

  private func nextStateRevision() -> Int {
    stateRevision += 1
    return stateRevision
  }

  private func emitStateChanged(_ snapshot: FlinkPDFSnapshot) {
    onReaderStateChanged([
      "readerSessionId": snapshot.readerSessionId,
      "stateRevision": snapshot.stateRevision,
      "snapshot": snapshot.wireValue
    ])
  }

  private func emitPageChanged(_ snapshot: FlinkPDFSnapshot) {
    onPageChanged([
      "readerSessionId": snapshot.readerSessionId,
      "stateRevision": snapshot.stateRevision,
      "pageIndex": snapshot.pageIndex,
      "pageCount": snapshot.pageCount
    ])
  }

  private func emitReaderError(
    error: FlinkPDFException,
    readerSessionId: String,
    stateRevision: Int
  ) {
    onReaderError([
      "readerSessionId": readerSessionId,
      "stateRevision": stateRevision,
      "error": error.wireValue
    ])
  }

  private func ensureCurrentOpen(
    generation: UInt64,
    openRequestId: String
  ) throws {
    guard isCurrentOpen(generation: generation, openRequestId: openRequestId) else {
      throw FlinkPDFErrors.supersededOpen()
    }
  }

  private func isCurrentOpen(generation: UInt64, openRequestId: String) -> Bool {
    generation == openGeneration && activeOpenRequestId == openRequestId
  }

  private func isValidDocumentReference(_ document: FlinkDocumentRefRecord) -> Bool {
    isValidIdentifier(document.fileId) && isValidIdentifier(document.revision)
  }

  private func isValidIdentifier(_ value: String) -> Bool {
    FlinkIdentifier.isValid(value)
  }

  private static var nativeNowMs: Double {
    ProcessInfo.processInfo.systemUptime * 1_000
  }
}

private enum FlinkPDFNavigationSource: String {
  case manual
  case blink
}

/// NSFilePresenter may invoke relinquish callbacks more than once under races.
/// Guard the coordinator completion so PDFKit never releases it twice.
internal final class FlinkPDFOneShotCompletion: @unchecked Sendable {
  private let lock = NSLock()
  private var completion: (@Sendable () -> Void)?

  init(_ completion: @escaping @Sendable () -> Void) {
    self.completion = completion
  }

  func call() {
    lock.lock()
    let callback = completion
    completion = nil
    lock.unlock()
    callback?()
  }
}
