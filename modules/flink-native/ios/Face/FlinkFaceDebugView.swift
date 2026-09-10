import ARKit
import ExpoModulesCore
import Foundation
import Metal
import SceneKit
import UIKit

/// Release-capable diagnostic face view. The ARSCNView references the capture
/// coordinator's session, while an always-opaque SCNView in front guarantees
/// that the captured camera image is never visible, including the first frame.
@MainActor
internal final class FlinkFaceDebugView: ExpoView, FlinkFaceDebugSink {
  private let coordinator = FaceSessionCoordinator.shared
  private let arSceneView = ARSCNView(frame: .zero)
  private let cameraCoverView = UIView(frame: .zero)
  private let faceSceneView = SCNView(frame: .zero)
  private let faceNode = SCNNode()
  private let cameraNode = SCNNode()
  private var faceGeometry: ARSCNFaceGeometry?
  private var requestedVisible = false
  private var renderingEnabled = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    backgroundColor = .white
    isOpaque = true
    clipsToBounds = true
    isUserInteractionEnabled = false
    isAccessibilityElement = true
    accessibilityLabel = "顔トラッキングのデバッグ表示"

    configureARSceneView()
    configureFaceSceneView()
    cameraCoverView.backgroundColor = .white
    cameraCoverView.isOpaque = true
    cameraCoverView.isUserInteractionEnabled = false
    addSubview(arSceneView)
    // A plain opaque layer is committed before the SceneKit overlay's first
    // render, preventing even a transient camera-background frame.
    addSubview(cameraCoverView)
    addSubview(faceSceneView)

    coordinator.connectDebugSceneView(arSceneView)

    NotificationCenter.default.addObserver(
      self,
      selector: #selector(renderingConditionsDidChange(_:)),
      name: UIApplication.willResignActiveNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(renderingConditionsDidChange(_:)),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(renderingConditionsDidChange(_:)),
      name: UIScene.willDeactivateNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(renderingConditionsDidChange(_:)),
      name: UIScene.didActivateNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(renderingConditionsDidChange(_:)),
      name: ProcessInfo.thermalStateDidChangeNotification,
      object: nil
    )

    updateRenderingState()
  }

  deinit {
    NotificationCenter.default.removeObserver(self)
    coordinator.detachDebugSink(self)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    arSceneView.frame = bounds
    cameraCoverView.frame = bounds
    faceSceneView.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateRenderingState()
  }

  func setVisible(_ visible: Bool) {
    requestedVisible = visible
    updateRenderingState()
  }

  func faceCoordinatorDidUpdate(_ frame: FlinkFaceDebugFrame?) {
    dispatchPrecondition(condition: .onQueue(.main))
    guard renderingEnabled else {
      return
    }

    // Reassert both opaque backgrounds on every displayed update. ARSCNView's
    // documented default is a live camera background, but it remains covered.
    arSceneView.scene.background.contents = UIColor.white
    faceSceneView.scene?.background.contents = UIColor.white

    guard let frame, let faceGeometry else {
      faceNode.isHidden = true
      faceSceneView.setNeedsDisplay()
      return
    }

    faceGeometry.update(from: frame.geometry)
    faceNode.simdTransform = frame.cameraRelativeTransform
    faceNode.isHidden = false
    faceSceneView.setNeedsDisplay()
  }

  @objc private func renderingConditionsDidChange(_: Notification) {
    if Thread.isMainThread {
      updateRenderingState()
    } else {
      DispatchQueue.main.async { [weak self] in
        self?.updateRenderingState()
      }
    }
  }

  private func configureARSceneView() {
    arSceneView.backgroundColor = .white
    arSceneView.isOpaque = true
    arSceneView.scene.background.contents = UIColor.white
    arSceneView.automaticallyUpdatesLighting = false
    arSceneView.preferredFramesPerSecond = 30
    arSceneView.rendersContinuously = false
    arSceneView.isPlaying = false
    arSceneView.isUserInteractionEnabled = false
  }

  private func configureFaceSceneView() {
    let scene = SCNScene()
    scene.background.contents = UIColor.white
    faceSceneView.scene = scene
    faceSceneView.backgroundColor = .white
    faceSceneView.isOpaque = true
    faceSceneView.preferredFramesPerSecond = 30
    faceSceneView.rendersContinuously = false
    faceSceneView.isPlaying = false
    faceSceneView.antialiasingMode = .multisampling4X
    faceSceneView.isUserInteractionEnabled = false

    let camera = SCNCamera()
    camera.fieldOfView = 60
    camera.zNear = 0.001
    camera.zFar = 10
    cameraNode.camera = camera
    scene.rootNode.addChildNode(cameraNode)
    faceSceneView.pointOfView = cameraNode

    guard let device = MTLCreateSystemDefaultDevice(),
          let geometry = ARSCNFaceGeometry(device: device, fillMesh: false) else {
      faceNode.isHidden = true
      return
    }

    let material = SCNMaterial()
    material.lightingModel = .constant
    material.diffuse.contents = UIColor(
      red: 58.0 / 255.0,
      green: 58.0 / 255.0,
      blue: 58.0 / 255.0,
      alpha: 1
    )
    material.isDoubleSided = true
    geometry.materials = [material]
    faceGeometry = geometry
    faceNode.geometry = geometry
    faceNode.isHidden = true
    scene.rootNode.addChildNode(faceNode)
  }

  private func updateRenderingState() {
    let applicationIsActive = UIApplication.shared.applicationState == .active
    let sceneIsActive = window?.windowScene?.activationState == .foregroundActive
    let thermalState = ProcessInfo.processInfo.thermalState
    let thermalAllowsRendering = thermalState != .serious && thermalState != .critical
    let shouldRender = requestedVisible &&
      sceneIsActive &&
      applicationIsActive &&
      thermalAllowsRendering

    isHidden = !requestedVisible
    guard shouldRender != renderingEnabled else {
      return
    }
    renderingEnabled = shouldRender

    if shouldRender {
      coordinator.attachDebugSink(self)
    } else {
      coordinator.detachDebugSink(self)
      arSceneView.isPlaying = false
      faceSceneView.isPlaying = false
      faceNode.isHidden = true
      faceSceneView.setNeedsDisplay()
    }
  }
}
