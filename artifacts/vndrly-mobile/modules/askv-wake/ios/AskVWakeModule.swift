import AVFoundation
import ExpoModulesCore
import UIKit

private struct AskVWakeOptions: Record {
  @Field var modelDirectory: String = ""
}

/// Synchronizes the realtime audio callback with immediate lifecycle cancellation.
private final class AskVCaptureGate {
  private let lock = NSLock()
  private var serial: UInt64 = 0
  private var current: UInt64?
  private var queuedFrames = 0
  private var modeRevision: UInt64 = 0
  private var desiredDetection = true

  func begin() -> UInt64 {
    lock.lock()
    defer { lock.unlock() }
    serial &+= 1
    current = serial
    modeRevision = 0
    desiredDetection = true
    queuedFrames = 0
    return serial
  }

  func invalidate() {
    lock.lock()
    current = nil
    queuedFrames = 0
    lock.unlock()
  }

  func isCurrent(_ token: UInt64) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return current == token
  }

  func changeMode(_ enabled: Bool, token: UInt64) -> UInt64? {
    lock.lock()
    defer { lock.unlock() }
    guard current == token else { return nil }
    modeRevision &+= 1
    desiredDetection = enabled
    return modeRevision
  }

  func mode(_ token: UInt64) -> (revision: UInt64, detection: Bool)? {
    lock.lock()
    defer { lock.unlock() }
    guard current == token else { return nil }
    return (modeRevision, desiredDetection)
  }

  func isCurrent(_ token: UInt64, revision: UInt64) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return current == token && modeRevision == revision
  }

  func reserve(_ token: UInt64) -> UInt64? {
    lock.lock()
    defer { lock.unlock() }
    guard current == token, queuedFrames < 16 else { return nil }
    queuedFrames += 1
    return modeRevision
  }

  func release(_ token: UInt64) {
    lock.lock()
    if current == token { queuedFrames = max(0, queuedFrames - 1) }
    lock.unlock()
  }
}

/// Only two seconds of foreground audio live here; samples never touch disk.
private struct AskVPreroll {
  private var storage = [Float](repeating: 0, count: 32_000)
  private var position = 0
  private var count = 0

  mutating func append(_ samples: [Float]) {
    for sample in samples {
      storage[position] = sample
      position = (position + 1) % storage.count
      count = min(count + 1, storage.count)
    }
  }

  func snapshot() -> [Float] {
    let start = (position - count + storage.count) % storage.count
    return (0..<count).map { storage[(start + $0) % storage.count] }
  }

  mutating func clear() {
    storage = [Float](repeating: 0, count: 32_000)
    position = 0
    count = 0
  }
}

public final class AskVWakeModule: Module {
  private let dspQueue = DispatchQueue(label: "ai.vndrly.askv.wake", qos: .userInitiated)
  private let gate = AskVCaptureGate()
  private let conversationAudio = AskVConversationAudio()

  // Main queue owns microphone/session state.
  private var audioEngine: AVAudioEngine?
  private var hasTap = false
  private var ownsAudioSession = false
  private var token: UInt64?
  private var pendingStart: Promise?
  private var observers: [NSObjectProtocol] = []

  // DSP queue owns model, resampler and short-lived PCM.
  private var keywordEngine: AskVKeywordEngine?
  private var converter: AVAudioConverter?
  private var detectionEnabled = true
  private var appliedModeRevision: UInt64 = 0
  private var preroll = AskVPreroll()

  public func definition() -> ModuleDefinition {
    Name("AskVWake")
    Events("onWake", "onAudio", "onError")

    OnCreate { self.onMain { self.observeLifecycle() } }

    AsyncFunction("configureConversationAudio") {
      try self.conversationAudio.configure()
    }.runOnQueue(.main)

    AsyncFunction("releaseConversationAudio") {
      self.conversationAudio.releaseConfiguration()
    }.runOnQueue(.main)

    AsyncFunction("start") { (options: AskVWakeOptions, promise: Promise) in
      self.start(options: options, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("stop") {
      self.stopCapture()
    }.runOnQueue(.main)

    AsyncFunction("setDetectionEnabled") { (enabled: Bool, promise: Promise) in
      guard let current = self.token, self.gate.isCurrent(current) else {
        promise.reject("NOT_RUNNING", "The local microphone is stopped.")
        return
      }
      guard let revision = self.gate.changeMode(enabled, token: current) else {
        promise.reject("CANCELLED", "The local microphone was stopped.")
        return
      }
      self.dspQueue.async {
        guard self.gate.isCurrent(current) else {
          promise.reject("CANCELLED", "The local microphone was stopped.")
          return
        }
        self.applyMode(current: current, revision: revision)
        promise.resolve()
      }
    }.runOnQueue(.main)

    OnDestroy { self.teardown() }
    OnAppContextDestroys { self.teardown() }
  }

  private func onMain(_ body: () -> Void) {
    if Thread.isMainThread { body() } else { DispatchQueue.main.sync(execute: body) }
  }

  private func observeLifecycle() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification] {
      observers.append(center.addObserver(forName: name, object: nil, queue: nil) { [weak self] _ in
        self?.onMain { self?.stopCapture(errorCode: "APP_INACTIVE") }
      })
    }
    observers.append(center.addObserver(
      forName: AVAudioSession.interruptionNotification, object: nil, queue: nil
    ) { [weak self] notification in
      let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      if raw == AVAudioSession.InterruptionType.began.rawValue {
        self?.onMain { self?.stopCapture(errorCode: "AUDIO_INTERRUPTED") }
      }
    })
    observers.append(center.addObserver(
      forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: nil
    ) { [weak self] _ in
      self?.onMain { self?.stopCapture(errorCode: "AUDIO_INTERRUPTED") }
    })
    observers.append(center.addObserver(
      forName: .AVAudioEngineConfigurationChange, object: nil, queue: nil
    ) { [weak self] notification in
      self?.onMain {
        guard let self, let changedEngine = notification.object as? AVAudioEngine,
              changedEngine === self.audioEngine else { return }
        self.stopCapture(errorCode: "AUDIO_ROUTE_CHANGED")
      }
    })
  }

  private func teardown() {
    onMain {
      stopCapture()
      conversationAudio.releaseConfiguration()
      for observer in observers { NotificationCenter.default.removeObserver(observer) }
      observers.removeAll()
    }
  }

  private func modelPath(_ requested: String) throws -> String {
    if !requested.isEmpty {
      if let url = URL(string: requested), url.isFileURL { return url.path }
      guard requested.hasPrefix("/") else {
        throw NSError(domain: "AskVWake", code: 1)
      }
      return requested
    }
    for bundle in [Bundle.main, Bundle(for: AskVWakeModule.self)] {
      if let url = bundle.url(forResource: "AskVWakeModels", withExtension: "bundle") {
        return url.path
      }
    }
    throw NSError(domain: "AskVWake", code: 1)
  }

  private func start(options: AskVWakeOptions, promise: Promise) {
    stopCapture()
    guard UIApplication.shared.applicationState == .active else {
      promise.reject("APP_INACTIVE", "Wake detection is available only while the app is active.")
      return
    }
    let current = gate.begin()
    token = current
    pendingStart = promise
    let session = AVAudioSession.sharedInstance()
    switch session.recordPermission {
    case .granted:
      initializeModel(options: options, current: current)
    case .denied:
      stopCapture(errorCode: "MIC_PERMISSION_DENIED")
    case .undetermined:
      session.requestRecordPermission { [weak self] granted in
        DispatchQueue.main.async {
          guard let self, self.gate.isCurrent(current) else { return }
          guard UIApplication.shared.applicationState == .active else {
            self.stopCapture(errorCode: "APP_INACTIVE")
            return
          }
          if granted {
            self.initializeModel(options: options, current: current)
          } else {
            self.stopCapture(errorCode: "MIC_PERMISSION_DENIED")
          }
        }
      }
    @unknown default:
      stopCapture(errorCode: "MIC_PERMISSION_DENIED")
    }
  }

  private func initializeModel(options: AskVWakeOptions, current: UInt64) {
    let directory: String
    do { directory = try modelPath(options.modelDirectory) } catch {
      stopCapture(errorCode: "MODEL_MISSING")
      return
    }
    dspQueue.async {
      guard self.gate.isCurrent(current) else { return }
      do {
        let detector = try AskVKeywordEngine(modelDirectory: directory)
        guard self.gate.isCurrent(current) else { return }
        self.keywordEngine = detector
        self.detectionEnabled = true
        self.appliedModeRevision = 0
        self.preroll.clear()
        DispatchQueue.main.async {
          guard self.gate.isCurrent(current) else { return }
          self.beginCapture(current: current)
        }
      } catch {
        self.fail("MODEL_INIT_FAILED", current: current)
      }
    }
  }

  private func beginCapture(current: UInt64) {
    guard gate.isCurrent(current), UIApplication.shared.applicationState == .active else {
      stopCapture(errorCode: "APP_INACTIVE")
      return
    }
    do {
      let session = AVAudioSession.sharedInstance()
      // Match WebRTC's eventual output configuration before installing the tap;
      // conflicting preferences can invalidate an already-running input format.
      try conversationAudio.configure()
      try session.setActive(true)
      ownsAudioSession = true

      let engine = AVAudioEngine()
      let input = engine.inputNode
      try input.setVoiceProcessingEnabled(true)
      audioEngine = engine
      let format = input.outputFormat(forBus: 0)
      guard format.sampleRate > 0, format.channelCount > 0,
            let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                            sampleRate: 16_000, channels: 1, interleaved: false),
            let resampler = AVAudioConverter(from: format, to: targetFormat) else {
        stopCapture(errorCode: "MIC_UNAVAILABLE")
        return
      }
      // Serial assignment precedes every tap callback on this queue.
      dspQueue.async { if self.gate.isCurrent(current) { self.converter = resampler } }
      input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
        self?.receive(buffer, current: current)
      }
      hasTap = true
      engine.prepare()
      try engine.start()
      pendingStart?.resolve()
      pendingStart = nil
    } catch {
      stopCapture(errorCode: "MIC_START_FAILED")
    }
  }

  private func receive(_ buffer: AVAudioPCMBuffer, current: UInt64) {
    guard let revision = gate.reserve(current) else {
      if gate.isCurrent(current) { fail("AUDIO_BACKPRESSURE", current: current) }
      return
    }
    guard let copied = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else {
      gate.release(current)
      fail("AUDIO_CONVERSION_FAILED", current: current)
      return
    }
    copied.frameLength = buffer.frameLength
    let source = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
    let destination = UnsafeMutableAudioBufferListPointer(copied.mutableAudioBufferList)
    for index in 0..<source.count {
      guard let from = source[index].mData, let to = destination[index].mData else { continue }
      memcpy(to, from, Int(source[index].mDataByteSize))
    }
    dspQueue.async {
      defer { self.gate.release(current) }
      guard self.gate.isCurrent(current, revision: revision), let converter = self.converter else { return }
      let capacity = AVAudioFrameCount(ceil(Double(copied.frameLength) * 16_000 / copied.format.sampleRate)) + 64
      guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else {
        self.fail("AUDIO_CONVERSION_FAILED", current: current)
        return
      }
      var supplied = false
      var error: NSError?
      let status = converter.convert(to: output, error: &error) { _, inputStatus in
        if supplied {
          inputStatus.pointee = .noDataNow
          return nil
        }
        supplied = true
        inputStatus.pointee = .haveData
        return copied
      }
      guard status != .error, error == nil else {
        self.fail("AUDIO_CONVERSION_FAILED", current: current)
        return
      }
      guard output.frameLength > 0, let channel = output.floatChannelData?[0] else { return }
      let samples = Array(UnsafeBufferPointer(start: channel, count: Int(output.frameLength))).map { $0.isFinite ? min(1, max(-1, $0)) : 0 }
      self.process(samples, current: current, revision: revision)
    }
  }

  private func applyMode(current: UInt64, revision: UInt64) {
    guard let mode = gate.mode(current), mode.revision == revision,
          appliedModeRevision != revision else { return }
    appliedModeRevision = revision
    detectionEnabled = mode.detection
    preroll.clear()
    if detectionEnabled, keywordEngine?.reset() != true {
      fail("MODEL_INFERENCE_FAILED", current: current)
    }
  }

  private func process(_ samples: [Float], current: UInt64, revision: UInt64) {
    guard gate.isCurrent(current, revision: revision) else { return }
    applyMode(current: current, revision: revision)
    if detectionEnabled {
      preroll.append(samples)
      let keyword: String?
      do {
        keyword = try samples.withUnsafeBufferPointer {
          try keywordEngine?.acceptSamples($0.baseAddress!, count: Int32($0.count))
        }
      } catch {
        fail("MODEL_INFERENCE_FAILED", current: current)
        return
      }
      if let keyword, !keyword.isEmpty {
        // Atomically hand off this microphone before JS begins session setup.
        detectionEnabled = false
        let initialAudio = preroll.snapshot()
        preroll.clear()
        emit("onWake", body: ["keyword": keyword, "samples": initialAudio, "sampleRate": 16_000], current: current, revision: revision)
      }
    } else {
      emit("onAudio", body: ["samples": samples, "sampleRate": 16_000], current: current, revision: revision)
    }
  }

  private func emit(_ name: String, body: [String: Any], current: UInt64, revision: UInt64) {
    DispatchQueue.main.async {
      guard self.gate.isCurrent(current, revision: revision) else { return }
      self.sendEvent(name, body)
    }
  }

  private func fail(_ code: String, current: UInt64) {
    DispatchQueue.main.async {
      guard self.gate.isCurrent(current) else { return }
      self.stopCapture(errorCode: code)
    }
  }

  /// Called on the main queue, including native lifecycle notifications.
  /// Invalidate first so queued model work, PCM and events cannot outlive stop.
  private func stopCapture(errorCode: String? = nil) {
    let hadSession = token != nil
    gate.invalidate()
    token = nil
    if let engine = audioEngine {
      if hasTap { engine.inputNode.removeTap(onBus: 0) }
      hasTap = false
      engine.stop()
      engine.reset()
    }
    audioEngine = nil
    if ownsAudioSession {
      try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
      ownsAudioSession = false
    }
    pendingStart?.reject(errorCode ?? "CANCELLED", "The local microphone was stopped.")
    pendingStart = nil
    dspQueue.async {
      self.keywordEngine = nil
      self.converter = nil
      self.detectionEnabled = true
      self.preroll.clear()
    }
    if hadSession, let errorCode { sendEvent("onError", ["code": errorCode]) }
  }
}

