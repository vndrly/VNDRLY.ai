Pod::Spec.new do |s|
  s.name = 'VndrlySafetyKit'
  s.version = '1.0.0'
  s.summary = 'Entitlement-gated VNDRLY crash awareness bridge'
  s.description = 'A fail-closed Expo module boundary for native crash awareness and explicit emergency dialing.'
  s.author = 'VNDRLY'
  s.homepage = 'https://vndrly.ai'
  s.license = { :type => 'MIT', :file => '../LICENSE' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit'
  s.source_files = '*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
