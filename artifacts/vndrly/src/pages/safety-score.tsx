import {VendorBonusScore} from "@/components/work-hub/repository-certifications";
import { SafetyMaturitySummary } from "@/components/safety-maturity-summary";
import CompanyTrainingBaseline from '@/components/company-training-baseline';
import EnergySafetyCore from '@/components/energy-safety-core';
import { useTranslation } from "react-i18next";




import { ShieldCheck } from "lucide-react";
import PageBackButton from "@/components/page-back-button";
import "@/components/current-theme-page.css";
export default function CompanySafetyScorePage() {
 const { t } = useTranslation();
 return <section className="current-theme-page safety-score-page space-y-4 p-4 md:p-6">
 <header className="flex items-center gap-2"><PageBackButton fallbackHref="/" /><ShieldCheck aria-hidden="true" className="h-6 w-6 shrink-0 text-[var(--brand-primary)]" /><h1 className="text-2xl font-bold">{t("safetyMaturity.title")}</h1></header>
 <CompanyTrainingBaseline />
 <EnergySafetyCore />
 <SafetyMaturitySummary />
 <VendorBonusScore/>
 </section>;
}
