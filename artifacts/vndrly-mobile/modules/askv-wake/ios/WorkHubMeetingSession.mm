#import "WorkHubMeetingSession.h"
#import "WorkHubPCMEncoder.h"
#import "AskVConversationAudio.h"

#import <AudioToolbox/AudioToolbox.h>
#import <WebRTC/WebRTC.h>
#import <mach/mach_time.h>
#include <array>
#include <atomic>
#include <cstring>

namespace {
constexpr AudioUnitElement kInputBus = 1;
constexpr AudioUnitElement kOutputBus = 0;
constexpr UInt32 kMaxFrames = 4096;
char kMeetingQueueKey;

const mach_timebase_info_data_t kHostTimebase = [] {
  mach_timebase_info_data_t value{};
  mach_timebase_info(&value);
  return value;
}();

uint64_t HostTimeToNanos(uint64_t hostTime) {
  if (kHostTimebase.denom == 0) return 0;
  const uint64_t whole = hostTime / kHostTimebase.denom;
  const uint64_t remainder = hostTime % kHostTimebase.denom;
  return whole * kHostTimebase.numer + remainder * kHostTimebase.numer / kHostTimebase.denom;
}

AudioStreamBasicDescription PCM16Mono(double rate) {
  AudioStreamBasicDescription format{};
  format.mSampleRate = rate;
  format.mFormatID = kAudioFormatLinearPCM;
  format.mFormatFlags = kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked;
  format.mBytesPerPacket = 2; format.mFramesPerPacket = 1; format.mBytesPerFrame = 2;
  format.mChannelsPerFrame = 1; format.mBitsPerChannel = 16;
  return format;
}
}

@interface WorkHubAudioDevice : NSObject <RTCAudioDevice>
- (instancetype)initWithEncoder:(WorkHubPCMEncoder *)encoder errorHandler:(void (^)(NSString *))errorHandler;
- (void)setCaptureAuthorized:(BOOL)authorized;
- (void)setTranscriptionEnabled:(BOOL)enabled policyRevision:(uint64_t)revision;
- (void)acknowledgeSequence:(uint64_t)sequence;
- (void)invalidateImmediately;
@end

@implementation WorkHubAudioDevice {
  id<RTCAudioDeviceDelegate> _delegate;
  WorkHubPCMEncoder *_encoder;
  void (^_errorHandler)(NSString *);
  AudioUnit _audioUnit;
  std::array<int16_t, kMaxFrames> _captureSamples;
  std::atomic<bool> _valid;
  std::atomic<bool> _teardownStarted;
  std::atomic<bool> _captureAuthorized;
  std::atomic<bool> _initialized;
  std::atomic<bool> _playoutInitialized;
  std::atomic<bool> _recordingInitialized;
  std::atomic<bool> _playing;
  std::atomic<bool> _recordingRequested;
  std::atomic<bool> _unitStarted;
  std::atomic<double> _sampleRate;
  AskVConversationAudio *_conversationAudio;
}

- (instancetype)initWithEncoder:(WorkHubPCMEncoder *)encoder errorHandler:(void (^)(NSString *))errorHandler {
  if ((self = [super init])) {
    _encoder = encoder; _errorHandler = [errorHandler copy]; _valid.store(true); _teardownStarted.store(false); _captureAuthorized.store(false);
    _initialized.store(false); _playoutInitialized.store(false); _recordingInitialized.store(false);
    _playing.store(false); _recordingRequested.store(false); _unitStarted.store(false); _sampleRate.store(48000);
    _conversationAudio = [[AskVConversationAudio alloc] init];
  }
  return self;
}

- (double)deviceInputSampleRate { return _sampleRate.load(std::memory_order_acquire); }
- (NSTimeInterval)inputIOBufferDuration { return [RTCAudioSession sharedInstance].IOBufferDuration; }
- (NSInteger)inputNumberOfChannels { return 1; }
- (NSTimeInterval)inputLatency { return [RTCAudioSession sharedInstance].inputLatency; }
- (double)deviceOutputSampleRate { return _sampleRate.load(std::memory_order_acquire); }
- (NSTimeInterval)outputIOBufferDuration { return [RTCAudioSession sharedInstance].IOBufferDuration; }
- (NSInteger)outputNumberOfChannels { return 1; }
- (NSTimeInterval)outputLatency { return [RTCAudioSession sharedInstance].outputLatency; }
- (BOOL)isInitialized { return _initialized.load(std::memory_order_acquire); }
- (BOOL)isPlayoutInitialized { return _playoutInitialized.load(std::memory_order_acquire); }
- (BOOL)isPlaying { return _playing.load(std::memory_order_acquire); }
- (BOOL)isRecordingInitialized { return _recordingInitialized.load(std::memory_order_acquire); }
- (BOOL)isRecording { return _recordingRequested.load(std::memory_order_acquire); }

- (BOOL)initializeWithDelegate:(id<RTCAudioDeviceDelegate>)delegate {
  if (!_valid.load()) return NO;
  _delegate = delegate; _initialized.store(true, std::memory_order_release); return YES;
}

- (void)report:(NSString *)code {
  if (_valid.exchange(false)) {
    [_encoder invalidate];
    dispatch_async(dispatch_get_main_queue(), ^{ self->_errorHandler(code); });
  }
}

static OSStatus Playout(void *context, AudioUnitRenderActionFlags *flags, const AudioTimeStamp *timestamp,
                        UInt32 bus, UInt32 frames, AudioBufferList *data) {
  WorkHubAudioDevice *device = (__bridge WorkHubAudioDevice *)context;
  if (!device->_valid.load() || !device->_playing.load(std::memory_order_acquire) || !device->_delegate) {
    for (UInt32 index = 0; index < data->mNumberBuffers; index += 1) memset(data->mBuffers[index].mData, 0, data->mBuffers[index].mDataByteSize);
    *flags |= kAudioUnitRenderAction_OutputIsSilence; return noErr;
  }
  return device->_delegate.getPlayoutData(flags, timestamp, bus, frames, data);
}

static OSStatus Capture(void *context, AudioUnitRenderActionFlags *flags, const AudioTimeStamp *timestamp,
                        UInt32 bus, UInt32 frames, AudioBufferList *) {
  WorkHubAudioDevice *device = (__bridge WorkHubAudioDevice *)context;
  if (!device->_valid.load() || frames == 0) return noErr;
  if (frames > kMaxFrames) { [device report:@"AUDIO_FORMAT_UNSUPPORTED"]; return kAudio_ParamError; }
  AudioBufferList input{}; input.mNumberBuffers = 1;
  input.mBuffers[0].mNumberChannels = 1; input.mBuffers[0].mDataByteSize = frames * sizeof(int16_t);
  input.mBuffers[0].mData = device->_captureSamples.data();
  OSStatus status = AudioUnitRender(device->_audioUnit, flags, timestamp, kInputBus, frames, &input);
  if (status != noErr) { [device report:@"MIC_CAPTURE_FAILED"]; return status; }
  if (device->_recordingRequested.load(std::memory_order_acquire) && device->_captureAuthorized.load() && device->_delegate) {
    status = device->_delegate.deliverRecordedData(flags, timestamp, bus, frames, &input, nullptr, nil);
    if (status != noErr) { [device report:@"MIC_CAPTURE_FAILED"]; return status; }
    const int64_t sampleTime = (timestamp->mFlags & kAudioTimeStampSampleTimeValid) ? (int64_t)timestamp->mSampleTime : -1;
    const uint64_t hostTimeNanos = (timestamp->mFlags & kAudioTimeStampHostTimeValid)
      ? HostTimeToNanos(timestamp->mHostTime) : 0;
    if (![device->_encoder enqueuePCM16:device->_captureSamples.data() frameCount:frames
          sampleRate:device->_sampleRate.load(std::memory_order_acquire) sampleTime:sampleTime hostTimeNanos:hostTimeNanos]) return kAudio_ParamError;
  }
  return noErr;
}

- (BOOL)runOnAudioDeviceQueue:(BOOL (^)(void))block {
  if (!_delegate) return block();
  __block BOOL result = NO;
  [_delegate dispatchSync:^{ result = block(); }];
  return result;
}

- (BOOL)prepareUnitOnAudioDeviceQueue {
  if (_audioUnit) return YES;
  RTCAudioSession *session = [RTCAudioSession sharedInstance];
  NSError *error = nil;
  BOOL ok = [_conversationAudio configure:&error];
  [session lockForConfiguration];
  if (ok) ok = [session setPreferredInputNumberOfChannels:1 error:&error];
  if (ok) ok = [session setPreferredOutputNumberOfChannels:1 error:&error];
  if (ok) ok = [session setActive:YES error:&error];
  [session unlockForConfiguration];
  if (!ok) { [self report:@"MIC_START_FAILED"]; return NO; }
  _sampleRate.store(session.sampleRate, std::memory_order_release);

  AudioComponentDescription description{ kAudioUnitType_Output, kAudioUnitSubType_VoiceProcessingIO, kAudioUnitManufacturer_Apple, 0, 0 };
  AudioComponent component = AudioComponentFindNext(nullptr, &description);
  if (!component || AudioComponentInstanceNew(component, &_audioUnit) != noErr) { [self report:@"MIC_START_FAILED"]; return NO; }
  UInt32 one = 1, zero = 0;
  AURenderCallbackStruct playout{ Playout, (__bridge void *)self };
  AURenderCallbackStruct capture{ Capture, (__bridge void *)self };
  AudioStreamBasicDescription format = PCM16Mono(_sampleRate.load(std::memory_order_acquire));
  OSStatus status = AudioUnitSetProperty(_audioUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Input, kInputBus, &one, sizeof(one));
  if (status == noErr) status = AudioUnitSetProperty(_audioUnit, kAudioOutputUnitProperty_EnableIO, kAudioUnitScope_Output, kOutputBus, &one, sizeof(one));
  if (status == noErr) status = AudioUnitSetProperty(_audioUnit, kAudioUnitProperty_ShouldAllocateBuffer, kAudioUnitScope_Output, kInputBus, &zero, sizeof(zero));
  if (status == noErr) status = AudioUnitSetProperty(_audioUnit, kAudioUnitProperty_SetRenderCallback, kAudioUnitScope_Input, kOutputBus, &playout, sizeof(playout));
  if (status == noErr) status = AudioUnitSetProperty(_audioUnit, kAudioOutputUnitProperty_SetInputCallback, kAudioUnitScope_Global, kInputBus, &capture, sizeof(capture));
  if (status == noErr) status = AudioUnitSetProperty(_audioUnit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Output, kInputBus, &format, sizeof(format));
  if (status == noErr) status = AudioUnitSetProperty(_audioUnit, kAudioUnitProperty_StreamFormat, kAudioUnitScope_Input, kOutputBus, &format, sizeof(format));
  if (status == noErr) status = AudioUnitInitialize(_audioUnit);
  if (status != noErr) { [self report:@"MIC_START_FAILED"]; return NO; }
  [_delegate notifyAudioInputParametersChange];
  [_delegate notifyAudioOutputParametersChange];
  return YES;
}

- (BOOL)updateUnitOnAudioDeviceQueue {
  BOOL needed = _playing.load(std::memory_order_acquire) ||
    (_recordingRequested.load(std::memory_order_acquire) && _captureAuthorized.load(std::memory_order_acquire));
  if (needed && !_unitStarted.load(std::memory_order_acquire)) {
    if (![self prepareUnitOnAudioDeviceQueue]) return NO;
    if (AudioOutputUnitStart(_audioUnit) != noErr) { [self report:@"MIC_START_FAILED"]; return NO; }
    _unitStarted.store(true, std::memory_order_release);
  } else if (!needed && _unitStarted.load(std::memory_order_acquire)) {
    AudioOutputUnitStop(_audioUnit); _unitStarted.store(false, std::memory_order_release);
  }
  return YES;
}

- (BOOL)initializePlayout { return [self runOnAudioDeviceQueue:^BOOL{
  BOOL ok = [self prepareUnitOnAudioDeviceQueue]; self->_playoutInitialized.store(ok, std::memory_order_release); return ok;
}]; }
- (BOOL)startPlayout { _playing.store(true, std::memory_order_release); return [self runOnAudioDeviceQueue:^BOOL{ return [self updateUnitOnAudioDeviceQueue]; }]; }
- (BOOL)stopPlayout { _playing.store(false, std::memory_order_release); return [self runOnAudioDeviceQueue:^BOOL{ return [self updateUnitOnAudioDeviceQueue]; }]; }
- (BOOL)initializeRecording { return [self runOnAudioDeviceQueue:^BOOL{
  BOOL ok = [self prepareUnitOnAudioDeviceQueue]; self->_recordingInitialized.store(ok, std::memory_order_release); return ok;
}]; }
- (BOOL)startRecording { _recordingRequested.store(true, std::memory_order_release); return [self runOnAudioDeviceQueue:^BOOL{ return [self updateUnitOnAudioDeviceQueue]; }]; }
- (BOOL)stopRecording {
  _recordingRequested.store(false, std::memory_order_release); [_encoder setEnabled:NO policyRevision:0];
  return [self runOnAudioDeviceQueue:^BOOL{ return [self updateUnitOnAudioDeviceQueue]; }];
}
- (void)setCaptureAuthorized:(BOOL)authorized {
  _captureAuthorized.store(authorized, std::memory_order_release);
  if (!authorized) [_encoder setEnabled:NO policyRevision:0];
  [self runOnAudioDeviceQueue:^BOOL{ return [self updateUnitOnAudioDeviceQueue]; }];
}
- (void)setTranscriptionEnabled:(BOOL)enabled policyRevision:(uint64_t)revision {
  [_encoder setEnabled:(enabled && _captureAuthorized.load()) policyRevision:revision];
}
- (void)acknowledgeSequence:(uint64_t)sequence { [_encoder acknowledgeSequence:sequence]; }

- (void)invalidateImmediately {
  _valid.store(false);
  if (_teardownStarted.exchange(true)) return;
  _captureAuthorized.store(false, std::memory_order_release); [_encoder invalidate];
  [self runOnAudioDeviceQueue:^BOOL{
    if (self->_unitStarted.load(std::memory_order_acquire)) {
      AudioOutputUnitStop(self->_audioUnit); self->_unitStarted.store(false, std::memory_order_release);
    }
    if (self->_delegate) { [self->_delegate notifyAudioInputInterrupted]; [self->_delegate notifyAudioOutputInterrupted]; }
    if (self->_audioUnit) {
      AudioUnitUninitialize(self->_audioUnit); AudioComponentInstanceDispose(self->_audioUnit); self->_audioUnit = nullptr;
    }
    BOOL stillOwnsAudioPolicy = [self->_conversationAudio ownsCurrentConfiguration];
    [self->_conversationAudio releaseConfiguration];
    (void)stillOwnsAudioPolicy;
    self->_initialized.store(false); self->_playoutInitialized.store(false); self->_recordingInitialized.store(false);
    self->_playing.store(false); self->_recordingRequested.store(false);
    return YES;
  }];
  _delegate = nil;
}

- (BOOL)terminateDevice {
  [self invalidateImmediately];
  return YES;
}
- (void)dealloc { [self terminateDevice]; }
@end

@interface WorkHubMeetingSession () <RTCPeerConnectionDelegate>
@end

@implementation WorkHubMeetingSession {
  NSString *_occurrenceId, *_sourceId;
  uint64_t _generation;
  __weak id<WorkHubMeetingSessionDelegate> _delegate;
  dispatch_queue_t _queue;
  std::atomic<bool> _valid;
  RTCPeerConnectionFactory *_factory;
  RTCAudioTrack *_track;
  WorkHubAudioDevice *_audioDevice;
  WorkHubPCMEncoder *_encoder;
  RTCConfiguration *_configuration;
  NSMutableDictionary<NSNumber *, RTCPeerConnection *> *_peers;
  NSMapTable<RTCPeerConnection *, NSNumber *> *_peerIds;
  NSMutableDictionary<NSNumber *, NSMutableArray<RTCIceCandidate *> *> *_pendingIce;
}

- (instancetype)initWithOccurrenceId:(NSString *)occurrenceId generation:(uint64_t)generation sourceId:(NSString *)sourceId
                           iceServers:(NSArray<NSDictionary *> *)iceServers delegate:(id<WorkHubMeetingSessionDelegate>)delegate {
  if ((self = [super init])) {
    _occurrenceId = [occurrenceId copy]; _generation = generation; _sourceId = [sourceId copy]; _delegate = delegate;
    _valid.store(true); _queue = dispatch_queue_create("ai.vndrly.workhub.meeting", DISPATCH_QUEUE_SERIAL);
    dispatch_queue_set_specific(_queue, &kMeetingQueueKey, &kMeetingQueueKey, nullptr);
    _peers = [NSMutableDictionary dictionary]; _peerIds = [NSMapTable weakToStrongObjectsMapTable]; _pendingIce = [NSMutableDictionary dictionary];
    __weak WorkHubMeetingSession *weakSelf = self;
    _encoder = [[WorkHubPCMEncoder alloc] initWithGeneration:generation sourceId:sourceId
      frameHandler:^(NSDictionary *frame) {
        WorkHubMeetingSession *strongSelf = weakSelf;
        if (strongSelf) [strongSelf->_delegate meetingSessionDidEmitPCMFrame:frame];
      }
      errorHandler:^(NSString *code) { [weakSelf fail:code]; }];
    _audioDevice = [[WorkHubAudioDevice alloc] initWithEncoder:_encoder errorHandler:^(NSString *code) { [weakSelf fail:code]; }];
    _factory = [[RTCPeerConnectionFactory alloc] initWithEncoderFactory:[[RTCDefaultVideoEncoderFactory alloc] init]
                                                          decoderFactory:[[RTCDefaultVideoDecoderFactory alloc] init]
                                                             audioDevice:_audioDevice];
    RTCAudioSource *source = [_factory audioSourceWithConstraints:[[RTCMediaConstraints alloc] initWithMandatoryConstraints:nil optionalConstraints:nil]];
    _track = [_factory audioTrackWithSource:source trackId:sourceId]; _track.isEnabled = NO;
    _configuration = [[RTCConfiguration alloc] init]; _configuration.sdpSemantics = RTCSdpSemanticsUnifiedPlan;
    NSMutableArray *servers = [NSMutableArray array];
    for (NSDictionary *value in iceServers) {
      id raw = value[@"urls"]; NSArray *urls = [raw isKindOfClass:[NSArray class]] ? raw : ([raw isKindOfClass:[NSString class]] ? @[raw] : @[]);
      if (!urls.count) continue;
      [servers addObject:[[RTCIceServer alloc] initWithURLStrings:urls username:value[@"username"] ?: @"" credential:value[@"credential"] ?: @""]];
    }
    _configuration.iceServers = servers;
  }
  return self;
}

- (void)fail:(NSString *)code {
  if (!_valid.load()) return;
  [self invalidate];
  dispatch_async(dispatch_get_main_queue(), ^{ [self->_delegate meetingSessionDidFail:code generation:self->_generation]; });
}
- (RTCPeerConnection *)peer:(NSInteger)peerUserId {
  NSNumber *key = @(peerUserId); RTCPeerConnection *peer = _peers[key]; if (peer) return peer;
  peer = [_factory peerConnectionWithConfiguration:_configuration constraints:[[RTCMediaConstraints alloc] initWithMandatoryConstraints:nil optionalConstraints:nil] delegate:self];
  if (!peer || ![peer addTrack:_track streamIds:@[_occurrenceId]]) { [self fail:@"AUDIO_PEER_FAILED"]; return nil; }
  _peers[key] = peer; [_peerIds setObject:key forKey:peer]; return peer;
}
- (void)emit:(NSInteger)peerUserId kind:(NSString *)kind payload:(NSDictionary *)payload {
  if (!_valid.load()) return;
  [_delegate meetingSessionDidEmitSignal:@{ @"generation": @(_generation), @"toUserId": @(peerUserId), @"kind": kind, @"payload": payload }];
}
- (void)setMuted:(BOOL)muted { if (_valid.load()) { _track.isEnabled = !muted; [_audioDevice setCaptureAuthorized:!muted]; } }
- (void)setTranscriptionEnabled:(BOOL)enabled policyRevision:(uint64_t)policyRevision { if (_valid.load()) [_audioDevice setTranscriptionEnabled:enabled policyRevision:policyRevision]; }
- (void)acknowledgeSequence:(uint64_t)sequence { if (_valid.load()) [_audioDevice acknowledgeSequence:sequence]; }
- (void)createOfferForPeerUserId:(NSInteger)peerUserId {
  dispatch_async(_queue, ^{ if (!self->_valid.load()) return; RTCPeerConnection *peer = [self peer:peerUserId];
    [peer offerForConstraints:[[RTCMediaConstraints alloc] initWithMandatoryConstraints:nil optionalConstraints:nil] completionHandler:^(RTCSessionDescription *sdp, NSError *error) {
      if (error || !sdp || !self->_valid.load()) { if (error) [self fail:@"AUDIO_SIGNAL_FAILED"]; return; }
      [peer setLocalDescription:sdp completionHandler:^(NSError *setError) {
        if (setError || !self->_valid.load()) { if (setError) [self fail:@"AUDIO_SIGNAL_FAILED"]; return; }
        [self emit:peerUserId kind:@"offer" payload:@{ @"type": [RTCSessionDescription stringForType:sdp.type], @"sdp": sdp.sdp }];
      }];
    }];
  });
}
- (void)drainIce:(NSNumber *)key peer:(RTCPeerConnection *)peer {
  if (!peer.remoteDescription) return;
  NSArray *pending = _pendingIce[key] ?: @[]; [_pendingIce removeObjectForKey:key];
  for (RTCIceCandidate *candidate in pending) [peer addIceCandidate:candidate completionHandler:^(NSError *error) { if (error) [self fail:@"AUDIO_SIGNAL_FAILED"]; }];
}
- (void)applySignalForPeerUserId:(NSInteger)peerUserId kind:(NSString *)kind payload:(NSDictionary *)payload {
  dispatch_async(_queue, ^{ if (!self->_valid.load()) return; NSNumber *key = @(peerUserId); RTCPeerConnection *peer = [self peer:peerUserId];
    if ([kind isEqualToString:@"ice"]) {
      RTCIceCandidate *candidate = [[RTCIceCandidate alloc] initWithSdp:payload[@"candidate"] ?: @"" sdpMLineIndex:[payload[@"sdpMLineIndex"] intValue] sdpMid:payload[@"sdpMid"]];
      if (peer.remoteDescription) [peer addIceCandidate:candidate completionHandler:^(NSError *error) { if (error) [self fail:@"AUDIO_SIGNAL_FAILED"]; }];
      else { NSMutableArray *pending = self->_pendingIce[key] ?: [NSMutableArray array]; [pending addObject:candidate]; self->_pendingIce[key] = pending; }
      return;
    }
    RTCSdpType type = [RTCSessionDescription typeForString:payload[@"type"] ?: kind];
    RTCSessionDescription *sdp = [[RTCSessionDescription alloc] initWithType:type sdp:payload[@"sdp"] ?: @""];
    [peer setRemoteDescription:sdp completionHandler:^(NSError *error) {
      if (error || !self->_valid.load()) { if (error) [self fail:@"AUDIO_SIGNAL_FAILED"]; return; }
      [self drainIce:key peer:peer];
      if (![kind isEqualToString:@"offer"]) return;
      [peer answerForConstraints:[[RTCMediaConstraints alloc] initWithMandatoryConstraints:nil optionalConstraints:nil] completionHandler:^(RTCSessionDescription *answer, NSError *answerError) {
        if (answerError || !answer || !self->_valid.load()) { if (answerError) [self fail:@"AUDIO_SIGNAL_FAILED"]; return; }
        [peer setLocalDescription:answer completionHandler:^(NSError *setError) {
          if (setError || !self->_valid.load()) { if (setError) [self fail:@"AUDIO_SIGNAL_FAILED"]; return; }
          [self emit:peerUserId kind:@"answer" payload:@{ @"type": [RTCSessionDescription stringForType:answer.type], @"sdp": answer.sdp }];
        }];
      }];
    }];
  });
}
- (void)removePeerUserId:(NSInteger)peerUserId {
  dispatch_async(_queue, ^{ NSNumber *key = @(peerUserId); RTCPeerConnection *peer = self->_peers[key];
    peer.delegate = nil; [peer close];
    [self->_peers removeObjectForKey:key]; [self->_pendingIce removeObjectForKey:key];
  });
}
- (void)invalidate {
  if (!_valid.exchange(false)) return;
  [_audioDevice invalidateImmediately]; [_encoder invalidate];
  dispatch_block_t closePeers = ^{ for (RTCPeerConnection *peer in self->_peers.allValues) { peer.delegate = nil; [peer close]; } [self->_peers removeAllObjects]; [self->_pendingIce removeAllObjects]; };
  if (dispatch_get_specific(&kMeetingQueueKey)) closePeers(); else dispatch_sync(_queue, closePeers);
  _track.isEnabled = NO; _track = nil; _factory = nil;
}
- (void)dealloc { [self invalidate]; }

- (void)peerConnection:(RTCPeerConnection *)peer didGenerateIceCandidate:(RTCIceCandidate *)candidate {
  NSNumber *peerId = [_peerIds objectForKey:peer]; if (!peerId || !_valid.load()) return;
  [self emit:peerId.integerValue kind:@"ice" payload:@{ @"candidate": candidate.sdp, @"sdpMid": candidate.sdpMid ?: [NSNull null], @"sdpMLineIndex": @(candidate.sdpMLineIndex) }];
}
- (void)peerConnection:(RTCPeerConnection *)peer didChangeConnectionState:(RTCPeerConnectionState)state {
  if (state == RTCPeerConnectionStateFailed || state == RTCPeerConnectionStateClosed) [self fail:@"AUDIO_CONNECTION_INTERRUPTED"];
}
- (void)peerConnection:(RTCPeerConnection *)peer didChangeSignalingState:(RTCSignalingState)stateChanged {}
- (void)peerConnection:(RTCPeerConnection *)peer didAddStream:(RTCMediaStream *)stream {}
- (void)peerConnection:(RTCPeerConnection *)peer didRemoveStream:(RTCMediaStream *)stream {}
- (void)peerConnectionShouldNegotiate:(RTCPeerConnection *)peer {}
- (void)peerConnection:(RTCPeerConnection *)peer didChangeIceConnectionState:(RTCIceConnectionState)newState {}
- (void)peerConnection:(RTCPeerConnection *)peer didChangeIceGatheringState:(RTCIceGatheringState)newState {}
- (void)peerConnection:(RTCPeerConnection *)peer didRemoveIceCandidates:(NSArray<RTCIceCandidate *> *)candidates {}
- (void)peerConnection:(RTCPeerConnection *)peer didOpenDataChannel:(RTCDataChannel *)dataChannel {}
@end
