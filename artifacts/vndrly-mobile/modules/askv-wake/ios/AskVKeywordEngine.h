#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// All methods are confined to the module's serial DSP queue.
@interface AskVKeywordEngine : NSObject
- (nullable instancetype)initWithModelDirectory:(NSString *)directory
                                         error:(NSError **)error NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (nullable NSString *)acceptSamples:(const float *)samples count:(int32_t)count error:(NSError **)error;
- (BOOL)reset;
@end

NS_ASSUME_NONNULL_END
