import type { AssistantPageContext } from "./page-context";

export function iosVoiceGreetingReply(
  message: string,
  language: string | null | undefined,
  context: AssistantPageContext | undefined,
): string | undefined {
  if (context?.path !== "/mobile/work-hub/askv" || context.inputMode !== "ios_voice") return undefined;

  // Match the entire utterance. A question, follow-up, or instruction needs the normal engine.
  if (!/^(?:¡)?(?:hi|hello|hey|hola|olá)[.!]?$/iu.test(message.trim())) return undefined;
  if (language === "es") return "Hola. ¿En qué puedo ayudarte?";
  if (language === "pt") return "Olá. Como posso ajudar?";
  return language == null || language === "en" ? "Hi. How can I help?" : undefined;
}
