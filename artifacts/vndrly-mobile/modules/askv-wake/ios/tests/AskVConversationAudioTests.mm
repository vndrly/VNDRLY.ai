#import <XCTest/XCTest.h>
#import <AVFoundation/AVFoundation.h>
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>
#import "AskVConversationAudio.h"

@interface AskVConversationAudioTests : XCTestCase
@property(nonatomic, strong) AskVConversationAudio *audio;
@property(nonatomic, strong) RTCAudioSessionConfiguration *originalPolicy;
@property(nonatomic, strong) RTCAudioSessionConfiguration *originalSession;
@end

@implementation AskVConversationAudioTests
- (void)setUp {
  [super setUp];
  self.originalPolicy = [RTCAudioSessionConfiguration webRTCConfiguration];
  self.originalSession = [RTCAudioSessionConfiguration currentConfiguration];
  self.audio = [[AskVConversationAudio alloc] init];
}

- (void)tearDown {
  [self.audio releaseConfiguration];
  [RTCAudioSessionConfiguration setWebRTCConfiguration:self.originalPolicy];
  RTCAudioSession *session = [RTCAudioSession sharedInstance];
  [session lockForConfiguration];
  [session setConfiguration:self.originalSession error:nil];
  [session unlockForConfiguration];
  [super tearDown];
}

- (void)testSpeakerDefaultSurvivesWebRTCConfigurationWithoutActivatingMicrophone {
  RTCAudioSession *session = [RTCAudioSession sharedInstance];
  BOOL wasActive = session.isActive;
  NSError *error = nil;
  XCTAssertTrue([self.audio configure:&error]);
  XCTAssertNil(error);
  RTCAudioSessionConfiguration *policy = [RTCAudioSessionConfiguration webRTCConfiguration];
  XCTAssertEqualObjects(policy.category, AVAudioSessionCategoryPlayAndRecord);
  XCTAssertTrue(policy.categoryOptions & AVAudioSessionCategoryOptionDefaultToSpeaker);
  XCTAssertTrue(policy.categoryOptions & AVAudioSessionCategoryOptionAllowBluetooth);
  XCTAssertEqual(policy.sampleRate, self.originalPolicy.sampleRate);
  XCTAssertEqual(policy.ioBufferDuration, self.originalPolicy.ioBufferDuration);
  XCTAssertEqual(session.isActive, wasActive);

  // WebRTC reapplies this policy when its audio device starts. It must not
  // revert the route or renegotiate the wake microphone's preferred format.
  double sampleRate = session.preferredSampleRate;
  NSTimeInterval duration = session.preferredIOBufferDuration;
  [session lockForConfiguration];
  XCTAssertTrue([session setConfiguration:policy error:&error]);
  [session unlockForConfiguration];
  XCTAssertTrue(session.categoryOptions & AVAudioSessionCategoryOptionDefaultToSpeaker);
  XCTAssertEqual(session.preferredSampleRate, sampleRate);
  XCTAssertEqual(session.preferredIOBufferDuration, duration);
  XCTAssertEqual(session.isActive, wasActive);
}

- (void)testRepeatedConfigureRestoresTheOriginalWebRTCPolicy {
  NSError *error = nil;
  XCTAssertTrue([self.audio configure:&error]);
  XCTAssertTrue([self.audio configure:&error]);
  [self.audio releaseConfiguration];
  XCTAssertEqual([RTCAudioSessionConfiguration webRTCConfiguration], self.originalPolicy);
  [self.audio releaseConfiguration];
  XCTAssertEqual([RTCAudioSessionConfiguration webRTCConfiguration], self.originalPolicy);
}

- (void)testReleasePreservesANewerOwnersWebRTCPolicy {
  NSError *error = nil;
  XCTAssertTrue([self.audio configure:&error]);
  RTCAudioSessionConfiguration *newOwner = [[RTCAudioSessionConfiguration alloc] init];
  [RTCAudioSessionConfiguration setWebRTCConfiguration:newOwner];
  [self.audio releaseConfiguration];
  XCTAssertEqual([RTCAudioSessionConfiguration webRTCConfiguration], newOwner);
}
@end
