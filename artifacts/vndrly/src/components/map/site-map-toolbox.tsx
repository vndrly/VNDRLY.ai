import { MessageCircleQuestion } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useAskVVoiceSession } from "@/hooks/use-askv-voice-session";

const PROMPTS = [
  ["Who is on site?", (site: string) => `Who is currently on site at ${site}?`],
  ["Show certification risks", (site: string) => `Show expired or expiring certifications for people at ${site}.`],
  ["Which drivers are delayed?", (site: string) => `Which drivers traveling to ${site} are delayed?`],
  ["What arrives next?", (site: string) => `What is expected to arrive next at ${site}?`],
  ["Summarize this site", (site: string) => `Summarize current operations at ${site}.`],
] as const;

export default function SiteMapToolbox({ siteName }: { siteName?: string | null }) {
  const voice = useAskVVoiceSession();
  const context = siteName?.trim() || "the selected site";
  const ask = (prompt: string) => {
    if (voice.muted) void voice.sendText(prompt);
    else void voice.startConversation(prompt, "/site-map");
  };
  return (
    <Card data-testid="site-map-toolbox">
      <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><MessageCircleQuestion className="h-4 w-4" />AskV Map Toolbox</CardTitle></CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {PROMPTS.map(([label, build]) => <PngPillButton key={label} color="brand" onClick={() => ask(build(context))}>{label}</PngPillButton>)}
      </CardContent>
    </Card>
  );
}
