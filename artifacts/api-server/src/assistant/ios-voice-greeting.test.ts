import { describe, expect, it } from "vitest";
import { iosVoiceGreetingReply } from "./ios-voice-greeting";

const context = { path: "/mobile/work-hub/askv", inputMode: "ios_voice" } as const;

describe("iPhone Ask V voice greeting", () => {
  it.each([
    ["Hi.", "en", "Hi. How can I help?"],
    ["Hi", "es", "Hola. ¿En qué puedo ayudarte?"],
    ["Olá!", "pt", "Olá. Como posso ajudar?"],
  ])("answers %s in the saved language", (message, language, reply) => {
    expect(iosVoiceGreetingReply(message, language, context)).toBe(reply);
  });

  it.each(["Hi?", "Hi, check the gate", "Hey V", "Yes", "Hi…", "Hi. Where am I?"])(
    "leaves %s to the shared assistant",
    message => expect(iosVoiceGreetingReply(message, null, context)).toBeUndefined(),
  );

  it("only applies on the dedicated iPhone voice route", () => {
    expect(iosVoiceGreetingReply("Hi", null, { ...context, inputMode: "ios_text" })).toBeUndefined();
    expect(iosVoiceGreetingReply("Hi", null, { ...context, path: "/mobile/gate" })).toBeUndefined();
  });
});
