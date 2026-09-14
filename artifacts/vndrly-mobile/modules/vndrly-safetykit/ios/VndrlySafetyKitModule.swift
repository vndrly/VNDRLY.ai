import ExpoModulesCore
import UIKit

/// Native boundary for Apple's entitlement-controlled severe-crash signal.
/// The public release remains manual-only until Apple grants the entitlement;
/// this module therefore compiles and reports unavailable without it.
public final class VndrlySafetyKitModule: Module {
  private var monitoring = false

  public func definition() -> ModuleDefinition {
    Name("VndrlySafetyKit")
    Events("onSevereCrash")

    AsyncFunction("getCapability") { () -> [String: Bool] in
      return ["entitlement": false, "supported": false, "permission": false]
    }

    AsyncFunction("startMonitoring") { () -> Bool in
      self.monitoring = false
      return false
    }

    AsyncFunction("stopMonitoring") {
      self.monitoring = false
    }

    AsyncFunction("openEmergencyDialer") {
      guard let url = URL(string: "tel:911") else { return }
      UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }.runOnQueue(.main)
  }
}
