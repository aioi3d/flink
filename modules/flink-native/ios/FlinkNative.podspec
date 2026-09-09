Pod::Spec.new do |s|
  s.name           = 'FlinkNative'
  s.version        = '1.0.0'
  s.summary        = 'Flink local file, PDFKit, and face-tracking bridge'
  s.description    = 'A local Expo Module used only by the Flink application.'
  s.license        = { :type => 'MIT' }
  s.author         = 'Flink'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '18.0' }
  s.swift_version  = '5.9'
  # Local development pod: CocoaPods receives the checkout path from Expo autolinking.
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Declare all Phase 2 system frameworks before the first development runtime.
  s.frameworks = 'ARKit', 'PDFKit', 'SceneKit', 'UIKit', 'UniformTypeIdentifiers'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
