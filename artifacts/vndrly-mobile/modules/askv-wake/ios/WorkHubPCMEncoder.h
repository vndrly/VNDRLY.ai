#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^WorkHubPCMFrameHandler)(NSDictionary<NSString *, id> *frame);
typedef void (^WorkHubPCMErrorHandler)(NSString *code);

/// A bounded, in-memory PCM16 encoder. The audio callback only copies into a
/// fixed SPSC ring; conversion, Base64 and bridge delivery run on its worker.
@interface WorkHubPCMEncoder : NSObject
- (instancetype)initWithGeneration:(uint64_t)generation
                           sourceId:(NSString *)sourceId
                       frameHandler:(WorkHubPCMFrameHandler)frameHandler
                       errorHandler:(WorkHubPCMErrorHandler)errorHandler NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (void)setEnabled:(BOOL)enabled policyRevision:(uint64_t)policyRevision;
- (BOOL)enqueuePCM16:(const int16_t *)samples
          frameCount:(uint32_t)frameCount
          sampleRate:(double)sampleRate
          sampleTime:(int64_t)sampleTime;
- (BOOL)enqueuePCM16:(const int16_t *)samples
          frameCount:(uint32_t)frameCount
          sampleRate:(double)sampleRate
          sampleTime:(int64_t)sampleTime
       hostTimeNanos:(uint64_t)hostTimeNanos;
- (void)acknowledgeSequence:(uint64_t)sequence;
- (void)invalidate;
@end

NS_ASSUME_NONNULL_END
