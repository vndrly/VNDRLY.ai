#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@protocol WorkHubMeetingSessionDelegate <NSObject>
- (void)meetingSessionDidEmitSignal:(NSDictionary<NSString *, id> *)signal;
- (void)meetingSessionDidEmitPCMFrame:(NSDictionary<NSString *, id> *)frame;
- (void)meetingSessionDidFail:(NSString *)code generation:(uint64_t)generation;
@end

/// Meeting-only WebRTC factory/session. It never installs a global audio device
/// and is inert until the caller explicitly unmutes it.
@interface WorkHubMeetingSession : NSObject
- (instancetype)initWithOccurrenceId:(NSString *)occurrenceId
                           generation:(uint64_t)generation
                             sourceId:(NSString *)sourceId
                           iceServers:(NSArray<NSDictionary *> *)iceServers
                             delegate:(id<WorkHubMeetingSessionDelegate>)delegate NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;
- (void)setMuted:(BOOL)muted;
- (void)setTranscriptionEnabled:(BOOL)enabled policyRevision:(uint64_t)policyRevision;
- (void)acknowledgeSequence:(uint64_t)sequence;
- (void)createOfferForPeerUserId:(NSInteger)peerUserId;
- (void)applySignalForPeerUserId:(NSInteger)peerUserId kind:(NSString *)kind payload:(NSDictionary *)payload;
- (void)removePeerUserId:(NSInteger)peerUserId;
- (void)invalidate;
@end

NS_ASSUME_NONNULL_END
