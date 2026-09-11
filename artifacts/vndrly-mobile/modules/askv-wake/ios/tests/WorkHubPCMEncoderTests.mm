#import <XCTest/XCTest.h>
#import "../WorkHubPCMEncoder.h"

@interface WorkHubPCMEncoderTests : XCTestCase
@end

@implementation WorkHubPCMEncoderTests
- (void)testFramesAreExactlyHalfASecondAt16kAndCreditsStayBounded {
  XCTestExpectation *twoFrames = [self expectationWithDescription:@"two frames"];
  twoFrames.expectedFulfillmentCount = 2;
  __block NSMutableArray<NSDictionary *> *frames = [NSMutableArray array];
  __block NSString *failure = nil;
  WorkHubPCMEncoder *encoder = [[WorkHubPCMEncoder alloc]
    initWithGeneration:7 sourceId:@"track-7"
    frameHandler:^(NSDictionary *frame) { [frames addObject:frame]; [twoFrames fulfill]; }
    errorHandler:^(NSString *code) { failure = code; }];
  [encoder setEnabled:YES policyRevision:3];
  int16_t samples[480]; memset(samples, 1, sizeof(samples));
  for (NSInteger block = 0; block < 100; block += 1) {
    XCTAssertTrue([encoder enqueuePCM16:samples frameCount:480 sampleRate:48000 sampleTime:block * 480]);
  }
  [self waitForExpectations:@[twoFrames] timeout:2];
  XCTAssertNil(failure); XCTAssertEqual(frames.count, 2);
  XCTAssertEqualObjects(frames[0][@"sampleCount"], @8000);
  XCTAssertEqualObjects(frames[1][@"firstSample"], @8000);
  XCTAssertEqualObjects(frames[1][@"sequence"], @1);
}

- (void)testInvalidationPreventsLateDelivery {
  XCTestExpectation *noFrame = [self expectationWithDescription:@"no frame"];
  noFrame.inverted = YES;
  WorkHubPCMEncoder *encoder = [[WorkHubPCMEncoder alloc]
    initWithGeneration:1 sourceId:@"track"
    frameHandler:^(__unused NSDictionary *frame) { [noFrame fulfill]; }
    errorHandler:^(__unused NSString *code) {}];
  [encoder setEnabled:YES policyRevision:1];
  [encoder invalidate];
  int16_t samples[480] = {};
  XCTAssertTrue([encoder enqueuePCM16:samples frameCount:480 sampleRate:48000 sampleTime:0]);
  [self waitForExpectations:@[noFrame] timeout:0.1];
}

- (void)testRestartDiscardsPartialAudioFromThePriorPolicy {
  XCTestExpectation *oneFrame = [self expectationWithDescription:@"one current frame"];
  __block NSMutableArray<NSDictionary *> *frames = [NSMutableArray array];
  WorkHubPCMEncoder *encoder = [[WorkHubPCMEncoder alloc]
    initWithGeneration:2 sourceId:@"track"
    frameHandler:^(NSDictionary *frame) { [frames addObject:frame]; [oneFrame fulfill]; }
    errorHandler:^(__unused NSString *code) { XCTFail(@"unexpected encoder failure"); }];
  int16_t samples[480]; memset(samples, 1, sizeof(samples));

  [encoder setEnabled:YES policyRevision:1];
  for (NSInteger block = 0; block < 25; block += 1) {
    XCTAssertTrue([encoder enqueuePCM16:samples frameCount:480 sampleRate:48000 sampleTime:block * 480]);
  }
  [encoder setEnabled:NO policyRevision:2];
  [encoder setEnabled:YES policyRevision:3];
  for (NSInteger block = 0; block < 50; block += 1) {
    XCTAssertTrue([encoder enqueuePCM16:samples frameCount:480 sampleRate:48000 sampleTime:block * 480]);
  }

  [self waitForExpectations:@[oneFrame] timeout:2];
  XCTAssertEqual(frames.count, 1);
  XCTAssertEqualObjects(frames[0][@"policyRevision"], @3);
  XCTAssertEqualObjects(frames[0][@"firstSample"], @0);
}

- (void)testExactSampleClockDiscontinuityFailsClosed {
  XCTestExpectation *failed = [self expectationWithDescription:@"sample discontinuity"];
  __block NSString *failure = nil;
  WorkHubPCMEncoder *encoder = [[WorkHubPCMEncoder alloc]
    initWithGeneration:4 sourceId:@"track"
    frameHandler:^(__unused NSDictionary *frame) {}
    errorHandler:^(NSString *code) { failure = code; [failed fulfill]; }];
  [encoder setEnabled:YES policyRevision:1];
  int16_t samples[480] = {};
  XCTAssertTrue([encoder enqueuePCM16:samples frameCount:480 sampleRate:48000 sampleTime:0]);
  XCTAssertTrue([encoder enqueuePCM16:samples frameCount:480 sampleRate:48000 sampleTime:481]);
  [self waitForExpectations:@[failed] timeout:2];
  XCTAssertEqualObjects(failure, @"AUDIO_TIMESTAMP_DISCONTINUITY");
}

- (void)testHostClockDiscontinuityFailsClosed {
  XCTestExpectation *failed = [self expectationWithDescription:@"host discontinuity"];
  __block NSString *failure = nil;
  WorkHubPCMEncoder *encoder = [[WorkHubPCMEncoder alloc]
    initWithGeneration:5 sourceId:@"track"
    frameHandler:^(__unused NSDictionary *frame) {}
    errorHandler:^(NSString *code) { failure = code; [failed fulfill]; }];
  [encoder setEnabled:YES policyRevision:1];
  int16_t samples[480] = {};
  XCTAssertTrue([encoder enqueuePCM16:samples frameCount:480 sampleRate:48000 sampleTime:-1 hostTimeNanos:1000000000]);
  XCTAssertTrue([encoder enqueuePCM16:samples frameCount:480 sampleRate:48000 sampleTime:-1 hostTimeNanos:1011000000]);
  [self waitForExpectations:@[failed] timeout:2];
  XCTAssertEqualObjects(failure, @"AUDIO_TIMESTAMP_DISCONTINUITY");
}

- (void)testInvalidTimestampFailsClosed {
  XCTestExpectation *failed = [self expectationWithDescription:@"invalid timestamp"];
  __block NSString *failure = nil;
  WorkHubPCMEncoder *encoder = [[WorkHubPCMEncoder alloc]
    initWithGeneration:6 sourceId:@"track"
    frameHandler:^(__unused NSDictionary *frame) {}
    errorHandler:^(NSString *code) { failure = code; [failed fulfill]; }];
  [encoder setEnabled:YES policyRevision:1];
  int16_t samples[480] = {};
  XCTAssertFalse([encoder enqueuePCM16:samples frameCount:480 sampleRate:48000 sampleTime:-1 hostTimeNanos:0]);
  [self waitForExpectations:@[failed] timeout:2];
  XCTAssertEqualObjects(failure, @"AUDIO_TIMESTAMP_INVALID");
}
@end
