#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Main-queue audio routing policy shared by manual conversations and wake capture.
/// Configuring the session neither activates it nor opens a microphone.
@interface AskVConversationAudio : NSObject
- (BOOL)configure:(NSError **)error;
- (BOOL)ownsCurrentConfiguration;
- (void)releaseConfiguration;
@end

NS_ASSUME_NONNULL_END
