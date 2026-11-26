import { spokenGateReply } from "./voice-reply";

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const compact = (words: string[]) => words.map(word => DIGITS.includes(word) ? String(DIGITS.indexOf(word)) : word).join("");

/** Gate speech in one place: short questions after a pause, never over the operator, and no reaction to AskV's own voice. */
export function createGateVoicePrompter(speak: (text: string) => void, pause = 1200) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let spoken = { words: [] as string[], at: 0 };
  let asked: string | null = null;
  // Operator turns that have started but whose words have not arrived yet.
  let open = 0, began = 0;
  const busy = () => open > 0 && Date.now() - began < 8_000;
  const say = (text: string) => {
    clearTimeout(timer);
    spoken = { words: spokenGateReply(text).split(" ").filter(Boolean), at: Date.now() };
    speak(text);
  };
  return {
    say,
    /** After an operator turn, ask once for what is still missing unless they keep talking. */
    ask(next: () => string | null, operatorSpoke = true) {
      clearTimeout(timer);
      if (operatorSpoke) asked = null;
      const fire = () => {
        if (busy()) { timer = setTimeout(fire, pause); return; }
        const text = next();
        if (text && text !== asked) { asked = text; say(text); }
      };
      timer = setTimeout(fire, pause);
    },
    hush() { clearTimeout(timer); },
    /** The operator started talking. Their words arrive later, sometimes after the next turn has begun. */
    began() { open++; began = Date.now(); },
    /** The words of one operator turn arrived, or it turned out to be noise. */
    heard() { open = Math.max(0, open - 1); },
    /** True while the operator is mid-sentence: not the moment to speak. */
    busy,
    /** The microphone can pick up the prompt AskV just spoke. That is not the operator. */
    echo(text: string): boolean {
      const heard = spokenGateReply(text).split(" ").filter(Boolean);
      if (!heard.length) return false;
      // Only AskV says this; an operator approving a check-in never does.
      if (/\bsay yes to check (?:in|out)\b/.test(heard.join(" "))) return true;
      // A long read-back is still playing well after it was requested.
      if (!spoken.words.length || Date.now() - spoken.at > 8_000 + 600 * spoken.words.length) return false;
      const whole = spoken.words.join(" "), part = heard.join(" ");
      if (part === whole) return true;
      if (heard.length >= 3 && ` ${whole} `.includes(` ${part} `)) return true;
      // The transcriber writes her spelled "K T X nine zero two" back as "KTX-902".
      const run = compact(heard);
      if (run.length >= 6 && compact(spoken.words).includes(run)) return true;
      return heard.length >= 5 && heard.filter(word => spoken.words.includes(word)).length >= heard.length * 0.7;
    },
  };
}
