import { SafetyMaturitySummary } from "@/components/safety-maturity-summary";
import { VendorBonusScore } from "../repository-certifications";
import CompanyTrainingBaseline from '@/components/company-training-baseline';
import EnergySafetyCore from '@/components/energy-safety-core';
import { useTranslation } from "react-i18next";




import { ShieldCheck } from "lucide-react";
import "@/components/current-theme-page.css";
export default function SafetyProgram() {
 const { t } = useTranslation();
 return <section className="current-theme-page safety-score-page space-y-4" aria-label={t("safetyMaturity.title")}>
 <header className="flex items-center gap-2"><ShieldCheck aria-hidden="true" className="h-6 w-6 shrink-0 text-[var(--brand-primary)]" /><h2 className="text-2xl font-bold">{t("safetyMaturity.title")}</h2></header>
 <CompanyTrainingBaseline />
 <VendorBonusScore />
 <EnergySafetyCore />
 <SafetyMaturitySummary />
 </section>;
}
