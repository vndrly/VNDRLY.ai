import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { CompanySafetyReadinessSchema } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import BrandPillButton from "@/components/brand-pill-button";
const base = import.meta.env.BASE_URL.replace(/\/$/, "");
export default function CompanySafetyScorePage() {
 const { t } = useTranslation(); const [, navigate] = useLocation(); const { user } = useAuth();
 const result = useQuery({ queryKey: ["company-safety-readiness", user?.userId, user?.vendorId, user?.partnerId], queryFn: async () => {const response=await fetch(`${base}/api/safety/readiness`,{credentials:"include"});if(!response.ok)throw Error("readiness unavailable");return CompanySafetyReadinessSchema.parse((await response.json()).data);} });
 return <div className="space-y-4 max-w-3xl">
 <h1 className="text-2xl font-bold">{t("safety.readiness.title")}</h1>
 <p>{t("safety.readiness.weights")}</p>
 {result.isLoading && <p>…</p>}{result.isError && <p role="alert">{t("safety.readiness.unavailable")}</p>}
 {result.data && <><Card><CardHeader><CardTitle>{result.data.score} / 100</CardTitle></CardHeader><CardContent className="space-y-3"><p>{t("safety.readiness.contributions",{readiness:result.data.readinessPoints.toFixed(1),incident:result.data.incidentPoints.toFixed(1)})}</p>{result.data.provisional && <p>{t("safety.readiness.provisional",{minimum:result.data.score,maximum:result.data.maximumScore})}</p>}</CardContent></Card>
 {result.data.categories.map(category=><Card key={category.id}><CardHeader><CardTitle>{t(`safety.readiness.${category.id}`)}</CardTitle></CardHeader><CardContent className="space-y-3"><p>{category.required?t("safety.readiness.counts",{completed:category.completed,required:category.required,outstanding:category.outstanding,unknown:category.unknown}):t("safety.readiness.noEvidence")}</p><p>{t("safety.readiness.points",{points:category.points.toFixed(1)})}</p>{result.data!.canManage && <BrandPillButton onClick={()=>navigate(category.id==="training"||category.id==="acknowledgements"?"/work-hub/library":category.id==="drivers"||category.id==="inspections"?"/fleet":category.id==="credentials"?"/field-employees":"/safety")}>{t(`safety.readiness.action_${category.id}`)}</BrandPillButton>}</CardContent></Card>)}<p className="text-sm text-muted-foreground">{t("safety.readiness.coverageNote")}</p></>}
 </div>;
}
