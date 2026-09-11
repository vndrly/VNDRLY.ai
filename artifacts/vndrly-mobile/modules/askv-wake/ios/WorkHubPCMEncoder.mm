#import "WorkHubPCMEncoder.h"

#include <array>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <mutex>
#include <cstring>
#include <set>

namespace {
constexpr size_t kSlots = 16;
constexpr size_t kMaxCallbackFrames = 4096;
constexpr size_t kOutputSamples = 8000;
constexpr uint64_t kMaxQueuedNanos = 500000000;
constexpr double kOutputRate = 16000.0;
constexpr int64_t kHostClockRoundingToleranceSamples = 2;

char kEncoderQueueKey;
struct Chunk {
  std::array<int16_t, kMaxCallbackFrames> samples{};
  uint32_t count = 0;
  double sampleRate = 0;
  int64_t sampleTime = 0;
  uint64_t hostTimeNanos = 0;
  uint64_t durationNanos = 0;
  uint64_t policyRevision = 0;
  uint64_t epoch = 0;
};
}

@implementation WorkHubPCMEncoder {
  uint64_t _generation;
  NSString *_sourceId;
  WorkHubPCMFrameHandler _frameHandler;
  WorkHubPCMErrorHandler _errorHandler;
  dispatch_queue_t _queue;
  dispatch_source_t _source;
  std::array<Chunk, kSlots> _chunks;
  std::atomic<uint64_t> _write;
  std::atomic<uint64_t> _read;
  std::atomic<uint64_t> _bufferedDurationNanos;
  std::atomic<bool> _active;
  std::atomic<bool> _enabled;
  std::atomic<bool> _failed;
  std::atomic<uint64_t> _policyRevision;
  std::atomic<uint64_t> _transcriptionEpoch;
  std::mutex _stateMutex;
  std::set<uint64_t> _outstanding;
  std::array<int16_t, kOutputSamples> _output;
  size_t _outputCount;
  double _inputRate;
  double _rateAccumulator;
  int64_t _filterSum;
  uint32_t _filterCount;
  int64_t _expectedInputSample;
  uint64_t _firstHostTimeNanos;
  uint64_t _lastHostTimeNanos;
  int _timingMode;
  uint64_t _sequence;
  uint64_t _firstOutputSample;
}

- (instancetype)initWithGeneration:(uint64_t)generation
                           sourceId:(NSString *)sourceId
                       frameHandler:(WorkHubPCMFrameHandler)frameHandler
                       errorHandler:(WorkHubPCMErrorHandler)errorHandler {
  if ((self = [super init])) {
    _generation = generation;
    _sourceId = [sourceId copy];
    _frameHandler = [frameHandler copy];
    _errorHandler = [errorHandler copy];
    _write.store(0); _read.store(0); _bufferedDurationNanos.store(0);
    _active.store(true); _enabled.store(false); _failed.store(false); _policyRevision.store(0); _transcriptionEpoch.store(0);
    _outputCount = 0; _inputRate = 0; _rateAccumulator = 0;
    _filterSum = 0; _filterCount = 0; _expectedInputSample = -1;
    _firstHostTimeNanos = 0; _lastHostTimeNanos = 0; _timingMode = 0;
    _sequence = 0; _firstOutputSample = 0;
    _queue = dispatch_queue_create("ai.vndrly.workhub.pcm", DISPATCH_QUEUE_SERIAL);
    _source = dispatch_source_create(DISPATCH_SOURCE_TYPE_DATA_ADD, 0, 0, _queue);
    dispatch_queue_set_specific(_queue, &kEncoderQueueKey, &kEncoderQueueKey, nullptr);
    __weak WorkHubPCMEncoder *weakSelf = self;
    dispatch_source_set_event_handler(_source, ^{ [weakSelf drain]; });
    dispatch_resume(_source);
  }
  return self;
}

- (void)resetWorkerState {
  _outputCount = 0; _inputRate = 0; _rateAccumulator = 0;
  _filterSum = 0; _filterCount = 0; _expectedInputSample = -1;
  _firstHostTimeNanos = 0; _lastHostTimeNanos = 0; _timingMode = 0;
  _sequence = 0; _firstOutputSample = 0;
  std::lock_guard<std::mutex> lock(_stateMutex);
  _outstanding.clear();
}
- (void)discardAndResetWorkerState {
  const uint64_t write = _write.load(std::memory_order_acquire);
  _read.store(write, std::memory_order_release);
  _bufferedDurationNanos.store(0, std::memory_order_release);
  [self resetWorkerState];
}


- (void)setEnabled:(BOOL)enabled policyRevision:(uint64_t)policyRevision {
  if (!_active.load(std::memory_order_acquire)) return;
  _enabled.store(false, std::memory_order_release);
  const uint64_t boundaryEpoch = _transcriptionEpoch.fetch_add(1, std::memory_order_acq_rel) + 1;
  _policyRevision.store(policyRevision, std::memory_order_release);
  if (!enabled) {
    dispatch_async(_queue, ^{ [self discardAndResetWorkerState]; });
    return;
  }
  dispatch_block_t reset = ^{ [self discardAndResetWorkerState]; };
  if (dispatch_get_specific(&kEncoderQueueKey)) reset(); else dispatch_sync(_queue, reset);
  if (_active.load(std::memory_order_acquire) &&
      _transcriptionEpoch.load(std::memory_order_acquire) == boundaryEpoch &&
      _policyRevision.load(std::memory_order_acquire) == policyRevision) {
    _enabled.store(true, std::memory_order_release);
  }
}

- (void)fail:(NSString *)code {
  bool expected = false;
  if (!_failed.compare_exchange_strong(expected, true)) return;
  _enabled.store(false, std::memory_order_release);
  _transcriptionEpoch.fetch_add(1, std::memory_order_acq_rel);
  _active.store(false, std::memory_order_release);
  dispatch_async(dispatch_get_main_queue(), ^{ self->_errorHandler(code); });
}

- (BOOL)enqueuePCM16:(const int16_t *)samples
          frameCount:(uint32_t)frameCount
          sampleRate:(double)sampleRate
          sampleTime:(int64_t)sampleTime {
  return [self enqueuePCM16:samples frameCount:frameCount sampleRate:sampleRate sampleTime:sampleTime hostTimeNanos:0];
}

- (BOOL)enqueuePCM16:(const int16_t *)samples
          frameCount:(uint32_t)frameCount
          sampleRate:(double)sampleRate
          sampleTime:(int64_t)sampleTime
       hostTimeNanos:(uint64_t)hostTimeNanos {
  const BOOL enqueueEnabled = _enabled.load(std::memory_order_acquire);
  const uint64_t enqueueEpoch = _transcriptionEpoch.load(std::memory_order_acquire);
  const uint64_t enqueuePolicyRevision = _policyRevision.load(std::memory_order_acquire);
  if (!_active.load(std::memory_order_acquire) || !enqueueEnabled ||
      !_enabled.load(std::memory_order_acquire) ||
      _transcriptionEpoch.load(std::memory_order_acquire) != enqueueEpoch ||
      _policyRevision.load(std::memory_order_acquire) != enqueuePolicyRevision) return YES;
  if (!samples || frameCount == 0 || frameCount > kMaxCallbackFrames || sampleRate < kOutputRate || sampleRate > 96000 || !std::isfinite(sampleRate)) {
    [self fail:@"AUDIO_FORMAT_UNSUPPORTED"]; return NO;
  }
  if (sampleTime < 0 && hostTimeNanos == 0) { [self fail:@"AUDIO_TIMESTAMP_INVALID"]; return NO; }
  const uint64_t write = _write.load(std::memory_order_relaxed);
  const uint64_t read = _read.load(std::memory_order_acquire);
  const uint64_t durationNanos = static_cast<uint64_t>(std::ceil((double)frameCount * 1000000000.0 / sampleRate));
  const uint64_t bufferedNanos = _bufferedDurationNanos.load(std::memory_order_acquire);
  if (write - read >= kSlots || durationNanos > kMaxQueuedNanos || bufferedNanos + durationNanos > kMaxQueuedNanos) {
    [self fail:@"AUDIO_BACKPRESSURE"]; return NO;
  }
  Chunk &chunk = _chunks[write % kSlots];
  memcpy(chunk.samples.data(), samples, frameCount * sizeof(int16_t));
  chunk.count = frameCount; chunk.sampleRate = sampleRate; chunk.sampleTime = sampleTime;
  chunk.hostTimeNanos = hostTimeNanos;
  chunk.durationNanos = durationNanos;
  chunk.policyRevision = enqueuePolicyRevision;
  chunk.epoch = enqueueEpoch;
  if (!_active.load(std::memory_order_acquire) || !_enabled.load(std::memory_order_acquire) ||
      _transcriptionEpoch.load(std::memory_order_acquire) != enqueueEpoch ||
      _policyRevision.load(std::memory_order_acquire) != enqueuePolicyRevision) return YES;
  _bufferedDurationNanos.fetch_add(durationNanos, std::memory_order_acq_rel);
  _write.store(write + 1, std::memory_order_release);
  dispatch_source_merge_data(_source, 1);
  return YES;
}

- (void)emitFrameForEpoch:(uint64_t)epoch policyRevision:(uint64_t)policyRevision {
  uint64_t sequence = _sequence++;
  {
    std::lock_guard<std::mutex> lock(_stateMutex);
    if (_outstanding.size() >= 2) { [self fail:@"AUDIO_BACKPRESSURE"]; return; }
    _outstanding.insert(sequence);
  }
  NSData *data = [NSData dataWithBytes:_output.data() length:kOutputSamples * sizeof(int16_t)];
  NSDictionary *frame = @{
    @"generation": @(_generation), @"sourceId": _sourceId, @"sequence": @(sequence),
    @"pcmBase64": [data base64EncodedStringWithOptions:0], @"sampleRate": @16000,
    @"channels": @1, @"sampleCount": @8000, @"firstSample": @(_firstOutputSample),
    @"policyRevision": @(policyRevision)
  };
  _firstOutputSample += kOutputSamples;
  dispatch_async(dispatch_get_main_queue(), ^{
    if (self->_active.load(std::memory_order_acquire) && self->_enabled.load(std::memory_order_acquire) &&
        self->_transcriptionEpoch.load(std::memory_order_acquire) == epoch &&
        self->_policyRevision.load(std::memory_order_acquire) == policyRevision) self->_frameHandler(frame);
  });
}

- (void)consume:(const Chunk &)chunk {
  if (_inputRate == 0) _inputRate = chunk.sampleRate;
  if (_inputRate != chunk.sampleRate) {
    [self fail:@"AUDIO_ROUTE_CHANGED"]; return;
  }
  int64_t inputStart = -1;
  if (chunk.sampleTime >= 0) {
    if (_timingMode == 2) { [self fail:@"AUDIO_TIMESTAMP_DISCONTINUITY"]; return; }
    _timingMode = 1; inputStart = chunk.sampleTime;
  } else if (chunk.hostTimeNanos > 0) {
    if (_timingMode == 1 || (_lastHostTimeNanos > 0 && chunk.hostTimeNanos <= _lastHostTimeNanos)) {
      [self fail:@"AUDIO_TIMESTAMP_DISCONTINUITY"]; return;
    }
    _timingMode = 2;
    if (_firstHostTimeNanos == 0) _firstHostTimeNanos = chunk.hostTimeNanos;
    inputStart = (int64_t)llround((double)(chunk.hostTimeNanos - _firstHostTimeNanos) * _inputRate / 1000000000.0);
    _lastHostTimeNanos = chunk.hostTimeNanos;
  } else {
    [self fail:@"AUDIO_TIMESTAMP_INVALID"]; return;
  }
  if (_expectedInputSample >= 0) {
    if ((_timingMode == 1 && inputStart != _expectedInputSample) ||
        (_timingMode == 2 && std::llabs(inputStart - _expectedInputSample) > kHostClockRoundingToleranceSamples)) {
      [self fail:@"AUDIO_TIMESTAMP_DISCONTINUITY"]; return;
    }
  }
  _expectedInputSample = inputStart + chunk.count;
  for (uint32_t index = 0; index < chunk.count && _active.load(std::memory_order_acquire); index += 1) {
    _filterSum += chunk.samples[index]; _filterCount += 1; _rateAccumulator += kOutputRate;
    if (_rateAccumulator + 1e-9 < _inputRate) continue;
    _rateAccumulator -= _inputRate;
    const int64_t averaged = _filterCount ? _filterSum / _filterCount : 0;
    _output[_outputCount++] = static_cast<int16_t>(std::max<int64_t>(INT16_MIN, std::min<int64_t>(INT16_MAX, averaged)));
    _filterSum = 0; _filterCount = 0;
    if (_outputCount == kOutputSamples) { [self emitFrameForEpoch:chunk.epoch policyRevision:chunk.policyRevision]; _outputCount = 0; }
  }
}

- (void)drain {
  while (_active.load(std::memory_order_acquire)) {
    const uint64_t read = _read.load(std::memory_order_relaxed);
    if (read == _write.load(std::memory_order_acquire)) break;
    Chunk chunk = _chunks[read % kSlots];
    _read.store(read + 1, std::memory_order_release);
    uint64_t buffered = _bufferedDurationNanos.load(std::memory_order_acquire);
    while (!_bufferedDurationNanos.compare_exchange_weak(buffered,
      buffered > chunk.durationNanos ? buffered - chunk.durationNanos : 0,
      std::memory_order_acq_rel, std::memory_order_acquire)) {}
    if (_enabled.load(std::memory_order_acquire) &&
        chunk.epoch == _transcriptionEpoch.load(std::memory_order_acquire) &&
        chunk.policyRevision == _policyRevision.load(std::memory_order_acquire)) [self consume:chunk];
  }
}

- (void)acknowledgeSequence:(uint64_t)sequence {
  dispatch_async(_queue, ^{
    std::lock_guard<std::mutex> lock(self->_stateMutex);
    self->_outstanding.erase(sequence);
  });
}

- (void)invalidate {
  _enabled.store(false, std::memory_order_release);
  _transcriptionEpoch.fetch_add(1, std::memory_order_acq_rel);
  _active.store(false, std::memory_order_release);
  _write.store(0, std::memory_order_release); _read.store(0, std::memory_order_release);
  _bufferedDurationNanos.store(0, std::memory_order_release);
  dispatch_async(_queue, ^{ [self discardAndResetWorkerState]; });
}

- (void)dealloc {
  [self invalidate];
  if (_source) dispatch_source_cancel(_source);
}
@end
