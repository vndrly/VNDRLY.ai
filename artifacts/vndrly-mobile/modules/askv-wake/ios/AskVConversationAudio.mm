#import "AskVConversationAudio.h"
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>

static BOOL SameStableDirectConfiguration(RTCAudioSessionConfiguration *left, RTCAudioSessionConfiguration *right) {
  if (!left || !right) return NO;
  return [left.category isEqualToString:right.category] &&
    [left.mode isEqualToString:right.mode] &&
    left.categoryOptions == right.categoryOptions;
}

@implementation AskVConversationAudio {
  RTCAudioSessionConfiguration *_previousConfiguration;
  RTCAudioSessionConfiguration *_installedConfiguration;
  RTCAudioSessionConfiguration *_previousSessionConfiguration;
  RTCAudioSessionConfiguration *_installedSessionConfiguration;
  BOOL _previousSessionActive;
}

- (BOOL)configure:(NSError **)error {
  RTCAudioSessionConfiguration *previous = [RTCAudioSessionConfiguration webRTCConfiguration];
  // webRTCConfiguration returns a shared object, not a copy. Retain it unchanged
  // so ending AskV can restore the policy that was in effect before this session.
  RTCAudioSessionConfiguration *configuration = [[RTCAudioSessionConfiguration alloc] init];
  configuration.category = AVAudioSessionCategoryPlayAndRecord;
  configuration.mode = AVAudioSessionModeVoiceChat;
  configuration.categoryOptions = previous.categoryOptions |
    AVAudioSessionCategoryOptionDefaultToSpeaker | AVAudioSessionCategoryOptionAllowBluetooth;
  configuration.sampleRate = previous.sampleRate;
  configuration.ioBufferDuration = previous.ioBufferDuration;
  configuration.inputNumberOfChannels = previous.inputNumberOfChannels;
  configuration.outputNumberOfChannels = previous.outputNumberOfChannels;

  RTCAudioSession *session = [RTCAudioSession sharedInstance];
  if (!_previousSessionConfiguration) {
    _previousSessionConfiguration = [RTCAudioSessionConfiguration currentConfiguration];
    _previousSessionActive = session.isActive;
  }
  [session lockForConfiguration];
  // This overload does not activate the session. Apply the same hardware
  // preferences before wake capture that WebRTC will use for answer playback.
  BOOL configured = [session setConfiguration:configuration error:error];
  if (configured) {
    if (!_previousConfiguration) _previousConfiguration = previous;
    _installedConfiguration = configuration;
    _installedSessionConfiguration = configuration;
    [RTCAudioSessionConfiguration setWebRTCConfiguration:configuration];
  }
  [session unlockForConfiguration];
  // defaultToSpeaker affects the built-in route; it preserves a connected
  // headset/Bluetooth route, unlike forcing overrideOutputAudioPort(.speaker).
  return configured;
}

- (BOOL)ownsCurrentConfiguration {
  return _installedConfiguration && [RTCAudioSessionConfiguration webRTCConfiguration] == _installedConfiguration &&
    SameStableDirectConfiguration([RTCAudioSessionConfiguration currentConfiguration], _installedSessionConfiguration);
}

- (void)releaseConfiguration {
  BOOL stillOwns = [self ownsCurrentConfiguration];
  if (_previousConfiguration && stillOwns) {
    RTCAudioSession *session = [RTCAudioSession sharedInstance];
    [session lockForConfiguration];
    [session setConfiguration:_previousSessionConfiguration error:nil];
    if (!_previousSessionActive && session.isActive) {
      // RTCAudioSession's supported deactivation API supplies
      // AVAudioSessionSetActiveOptionNotifyOthersOnDeactivation internally.
      [session setActive:NO error:nil];
    }
    [session unlockForConfiguration];
    [RTCAudioSessionConfiguration setWebRTCConfiguration:_previousConfiguration];
  }
  _previousConfiguration = nil;
  _installedConfiguration = nil;
  _previousSessionConfiguration = nil;
  _installedSessionConfiguration = nil;
  // The caller closes its peer/capture and restores expo-av's audio mode.
  // Do not deactivate AVAudioSession while another audio owner may still use it.
}
@end
