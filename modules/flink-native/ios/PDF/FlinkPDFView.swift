import ExpoModulesCore
import UIKit

/// The v1 native view is registered in Phase 1 so its ref contract is fixed.
/// PDFKit ownership and rendering are deliberately deferred to Phase 2.
internal final class FlinkPDFView: ExpoView {
  let onReaderStateChanged = EventDispatcher()
  let onPageChanged = EventDispatcher()
  let onReaderError = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isAccessibilityElement = true
    accessibilityLabel = "PDF viewer"
  }
}
