const fs = require("node:fs");
const path = require("node:path");
const { withAppDelegate, withDangerousMod } = require("expo/config-plugins");
const marker = "// AskV: OpenAI native WebRTC speaker default";
const headerImport = "#import <WebRTC/RTCAudioSessionConfiguration.h>";

// Reproduce the audio-routing policy documented in openai/openai-agents-js:
// examples/realtime-react-native/README.md @ 90a6b529a048981cf61224a32bda92a9525a18e2.
function speakerAppDelegate(source) {
  if (source.includes(marker)) return source;
  const entrypoint = /(didFinishLaunchingWithOptions[\s\S]*?\)\s*->\s*Bool\s*\{)/;
  if (!entrypoint.test(source)) throw new Error("AskV WebRTC speaker policy: unrecognized Swift application entrypoint");
  return source.replace(entrypoint, "$1\n    " + marker + "\n" +
    "    let askVWebRTC = RTCAudioSessionConfiguration.webRTC()\n" +
    "    askVWebRTC.categoryOptions.insert(.defaultToSpeaker)\n" +
    "    RTCAudioSessionConfiguration.setWebRTC(askVWebRTC)\n");
}
function speakerHeader(source) {
  return source.includes(headerImport) ? source : source + "\n" + headerImport + "\n";
}
function withAskVWebRTCSpeaker(config) {
  config = withAppDelegate(config, config => {
    config.modResults.contents = speakerAppDelegate(config.modResults.contents);
    return config;
  });
  return withDangerousMod(config, ["ios", async config => {
    const name = config.modRequest.projectName;
    const header = path.join(config.modRequest.platformProjectRoot, name, name + "-Bridging-Header.h");
    const contents = fs.existsSync(header) ? fs.readFileSync(header, "utf8") : "";
    fs.writeFileSync(header, speakerHeader(contents));
    return config;
  }]);
}
module.exports = withAskVWebRTCSpeaker;
module.exports.speakerAppDelegate = speakerAppDelegate;
module.exports.speakerHeader = speakerHeader;
