import ActivityKit
import Foundation

@available(iOS 16.2, *)
public struct VndrlyWorkAttributes: ActivityAttributes, Equatable {
  public struct ContentState: Codable, Hashable {
    public var phase: String
    public var recordedAt: Date
    public var expiresAt: Date
    public var company: String
    public var site: String
    public var identifier: String
    public var startedAt: Date?
    public var eta: Date?
  }
  public var contextHash: String
  public var subjectKind: String
  public var subjectId: String
}