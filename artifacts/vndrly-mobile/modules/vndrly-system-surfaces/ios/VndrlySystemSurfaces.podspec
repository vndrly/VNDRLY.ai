Pod::Spec.new do |s|
  s.name = 'VndrlySystemSurfaces'
  s.version = '1.0.0'
  s.summary = 'Account-bound local work Live Activities'
  s.description = 'Minimal foreground ActivityKit projections; no credentials, remote pushes or domain effects.'
  s.author = 'VNDRLY'
  s.homepage = 'https://vndrly.ai'
  s.license = { :type => 'MIT', :file => '../LICENSE' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.swift_version = '5.0'
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'UIKit'
  s.weak_frameworks = 'ActivityKit'
  s.source_files = '*.swift'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end