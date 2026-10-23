import { Receipt } from "lucide-react";
import { useTranslation } from "react-i18next";
import { gateDailyBillingCopy } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import PageBackButton from "@/components/page-back-button";
import GateDailyBillingPanel from "@/components/gate-daily-billing-panel";
export default function GateDailyBillingPage() {
  const { user } = useAuth(),
    { i18n } = useTranslation();
  return (
    <div className="space-y-5 p-4">
      <header className="flex items-center gap-3">
        <PageBackButton fallbackHref="/gate/history" />
        <Receipt aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--brand-primary)]" />
        <h1 className="text-2xl font-bold">
          {gateDailyBillingCopy("Gate daily billing", i18n.language)}
        </h1>
      </header>
      <GateDailyBillingPanel
        scopeKey={`${user?.userId}:${user?.vendorId}:${user?.role}:${user?.vendorRole}`}
      />
    </div>
  );
}
