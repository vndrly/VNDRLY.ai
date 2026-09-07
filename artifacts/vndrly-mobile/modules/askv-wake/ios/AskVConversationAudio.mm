#import "AskVConversationAudio.h"
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>

@implementation AskVConversationAudio {
  RTCAudioSessionConfiguration *_previousConfiguration;
  RTCAudioSessionConfiguration *_installedConfiguration;
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
  [session lockForConfiguration];
  // This overload does not activate the session. Apply the same hardware
  // preferences before wake capture that WebRTC will use for answer playback.
  BOOL configured = [session setConfiguration:configuration error:error];
  if (configured) {
    if (!_previousConfiguration) _previousConfiguration = previous;
    _installedConfiguration = configuration;
    [RTCAudioSessionConfiguration setWebRTCConfiguration:configuration];
  }
  [session unlockForConfiguration];
  // defaultToSpeaker affects the built-in route; it preserves a connected
  // headset/Bluetooth route, unlike forcing overrideOutputAudioPort(.speaker).
  return configured;
}

- (void)releaseConfiguration {
  if (_previousConfiguration &&
      [RTCAudioSessionConfiguration webRTCConfiguration] == _installedConfiguration) {
    [RTCAudioSessionConfiguration setWebRTCConfiguration:_previousConfiguration];
  }
  _previousConfiguration = nil;
  _installedConfiguration = nil;
  // The caller closes its peer/capture and restores expo-av's audio mode.
  // Do not deactivate AVAudioSession while another audio owner may still use it.
}
@end
