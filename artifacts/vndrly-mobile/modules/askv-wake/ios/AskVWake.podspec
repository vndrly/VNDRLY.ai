Pod::Spec.new do |s|
  s.name = 'AskVWake'
  s.version = '1.0.0'
  s.summary = 'Foreground, on-device AskV keyword detection'
  s.description = 'Local sherpa-onnx detection with a shared in-memory microphone stream.'
  s.author = 'VNDRLY'
  s.homepage = 'https://vndrly.ai'
  s.license = { :type => 'MIT', :file => '../LICENSE' }
  s.platforms = { :ios => '15.1' }
  s.source = { :git => '' }
  s.static_framework = true
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  # The app already installs this exact SDK through react-native-webrtc.
  s.dependency 'JitsiWebRTC', '~> 124.0.0'
  s.frameworks = 'AVFoundation', 'AudioToolbox', 'Accelerate', 'CoreML'
  s.libraries = 'c++'
  s.source_files = '*.{h,mm,swift}'
  s.public_header_files = 'AskVKeywordEngine.h', 'AskVConversationAudio.h', 'WorkHubPCMEncoder.h', 'WorkHubMeetingSession.h'
  s.vendored_frameworks = 'vendor/sherpa-onnx.xcframework', 'vendor/onnxruntime.xcframework'
  s.resource_bundles = {
    'AskVWakeModels' => ['../../../assets/askv-wake/*.{onnx,txt,json,md}', '../THIRD_PARTY_NOTICES.md']
  }
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'HEADER_SEARCH_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/vendor/sherpa-onnx.xcframework/Headers"'
  }

  s.test_spec 'AudioRoutingTests' do |test|
    test.source_files = 'tests/*.mm'
    test.frameworks = 'XCTest'
    test.requires_app_host = true
  end

  # Local development pods do not execute CocoaPods prepare_command.
  # Resolve these pinned inputs for fresh EAS/prebuild pod installs as well.
  unless File.exist?(File.join(__dir__, 'vendor', '.askv-engine-v1.12.29'))
    script = File.expand_path('../../../../../scripts/prepare-askv-ios.mjs', __dir__)
    raise 'AskV wake engine preparation failed' unless system('node', script)
  end
end

