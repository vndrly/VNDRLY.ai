import ActivityKit
import Foundation

@available(iOS 16.2, *)
public struct VndrlyWorkAttributes: ActivityAttributes, Equatable {
  public struct ContentState: Codable, Hashable {
    public var phase: String
    public var recordedAt: Date
    public var expiresAt: Date
  }
  public var contextHash: String
  public var subjectKind: String
  public var subjectId: String
}