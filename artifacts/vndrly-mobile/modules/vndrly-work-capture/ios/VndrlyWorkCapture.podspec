Pod::Spec.new do |s|
  s.name = 'VndrlyWorkCapture'
  s.version = '1.0.0'
  s.summary = 'Private user-started document drafts and upload transport'
  s.description = 'VisionKit, Vision, optional on-device Foundation Models and bounded URLSession upload transport.'
  s.author = 'VNDRLY'
  s.homepage = 'https://vndrly.ai'
  s.license = { :type => 'MIT', :file => '../LICENSE' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit', 'Vision', 'VisionKit'
  s.source_files = '*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
