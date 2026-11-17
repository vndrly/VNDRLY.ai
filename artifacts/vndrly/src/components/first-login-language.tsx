import { useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PngPillButton } from "./png-pill-rollover";
import { BrandedSelect } from "./work-hub/chrome";
import { withRequestDeadline } from "@/lib/request-deadline";

export default function FirstLoginLanguage() {
  const { user, setPreferredLanguage } = useAuth();
  const currentUser = useRef(user?.userId); currentUser.current = user?.userId;
  const { i18n } = useTranslation();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [language, setLanguage] = useState<"en" | "es">("en");
  const [error, setError] = useState("");
  const open = Boolean(user?.needsLanguageChoice && !user.mustChangePassword && !user.requiresContextChoice && dismissed !== user.userId);
  async function save(language: "en" | "es", dismiss = false) {
    if (!user || busy) return;
    const id = user.userId;
    if (dismiss) setDismissed(id);
    setBusy(true); setError("");
    try {
      await withRequestDeadline(async signal => {
        const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/auth/me/language`, { method:"PATCH",credentials:"include",signal,headers:{"Content-Type":"application/json"},body:JSON.stringify({language}) });
        if (!response.ok) throw Error("Language could not be saved. You can change it in Profile settings.");
      }, { timeoutMs:15000,timeoutMessage:"Language could not be saved. You can change it in Profile settings." });
      if (currentUser.current !== id) return;
      setPreferredLanguage(language);
      await i18n.changeLanguage(language);
      setDismissed(id);
    } catch {
      const message="Language could not be saved. You can change it in Profile settings.";
      if (dismiss) toast({title:message}); else setError(message);
    } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value=>{if(!value)void save("en",true);}}>
    <DialogContent data-testid="first-login-language" className="max-w-md rounded-xl border-2 border-[var(--brand-primary)] bg-[#242426] text-[#f8fafc]"><DialogHeader><DialogTitle>Choose your language</DialogTitle><DialogDescription>English is the default. You can change your language later in Profile settings.</DialogDescription></DialogHeader>
      <label htmlFor="first-login-language-choice">Language</label>
      <BrandedSelect id="first-login-language-choice" aria-label="Language" value={language} disabled={busy} onChange={event=>setLanguage(event.target.value as "en"|"es")}><option value="en">English</option><option value="es">Español</option></BrandedSelect>
      <PngPillButton color="brand" disabled={busy} onClick={()=>void save(language)}>{busy?"Saving…":"Continue"}</PngPillButton>
      {error && <p role="alert">{error}</p>}
    </DialogContent>
  </Dialog>;
}
