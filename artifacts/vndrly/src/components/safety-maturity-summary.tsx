import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { useSafetyMaturity } from "@/hooks/use-safety-maturity";
import {TrainingActions} from './work-hub/library/training-actions';
import {useAuth} from '@/hooks/use-auth';
import {isWorkHubAdmin} from '@/lib/work-hub-client';

export function SafetyMaturitySummary() {
  const { t } = useTranslation();
  const result = useSafetyMaturity();
  const {user}=useAuth();
  return <>
    <p>{t("safetyMaturity.separate")}</p>
    {result.isLoading && <p>…</p>}
    {result.isError && <p role="alert">{t("safety.readiness.unavailable")}</p>}
    {result.data && <>
      {result.data.incomplete && <p>{t("safetyMaturity.incomplete")}</p>}
      <div className="safety-score-cards">
        <Card><CardHeader><CardTitle>{result.data.score} / 100</CardTitle></CardHeader><CardContent>{t("safetyMaturity.title")}</CardContent></Card>
        {result.data.categories.map(category => <Card key={category.id}>
          <CardHeader><CardTitle><ShieldCheck aria-hidden="true" />{t(`safetyMaturity.${category.id}`)}</CardTitle></CardHeader>
          <CardContent className="safety-score-body">
            <p>{category.points} / {category.weight}</p>
            <p>{t(`safetyMaturity.level${category.level}`)}</p>
            {category.resources.map(resource => <Link key={resource.id} href={`/work-hub/library/${resource.id}`} className="block underline underline-offset-4">{resource.title}</Link>)}
            {(category.requirements ?? []).map(requirement => <section key={requirement.id} className="mt-4 space-y-2 border-t pt-3">
              <h3 className="font-semibold">{requirement.id} — {requirement.title}</h3>
              <p className="text-sm">{requirement.applicability}</p>
              {requirement.trainingRequirement&&<p>{t('trainingPolicy.coverage',{...requirement.trainingRequirement,familyId:requirement.id})}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {requirement.resources.map(resource => resource.type==='training'?<div key={resource.id} className="space-y-2"><p>{resource.title}</p><TrainingActions itemId={resource.id} canManage={isWorkHubAdmin(user)}/></div>:<Link key={resource.id} href={`/work-hub/library/${resource.id}`} className="underline underline-offset-4">{resource.title}</Link>)}
              </div>
            </section>)}
          </CardContent>
        </Card>)}
      </div>
    </>}
  </>;
}
