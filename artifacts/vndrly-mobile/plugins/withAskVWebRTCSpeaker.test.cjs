const { test } = require("node:test");
const assert = require("node:assert/strict");
const { speakerAppDelegate, speakerHeader } = require("./withAskVWebRTCSpeaker");
test("applies the official native example's speaker policy once before React Native starts", () => {
  const swift = "class AppDelegate {\n public override func application(\n _ application: UIApplication,\n didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil\n ) -> Bool {\n let delegate = ReactNativeDelegate()\n return true\n }\n}";
  const updated = speakerAppDelegate(swift);
  assert.ok(updated.indexOf("RTCAudioSessionConfiguration.setWebRTC") < updated.indexOf("let delegate"));
  assert.match(updated, /categoryOptions.insert\(\.defaultToSpeaker\)/);
  assert.equal(speakerAppDelegate(updated), updated);
  assert.equal(speakerHeader(speakerHeader("")), speakerHeader(""));
  assert.match(speakerHeader(""), /WebRTC\/RTCAudioSessionConfiguration.h/);
});
test("fails visibly if Expo changes the application entrypoint", () => {
  assert.throws(() => speakerAppDelegate("unrecognized"), /entrypoint/);
});
