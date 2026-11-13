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
        {result.data.categories.map(category => <Card key={category.id} className="safety-program-card">
          <CardHeader><CardTitle><ShieldCheck aria-hidden="true" />{t(`safetyMaturity.${category.id}`)}</CardTitle></CardHeader>
          <CardContent className="safety-score-body">
            <p>{category.points} / {category.weight}</p>
            <p>{t(`safetyMaturity.level${category.level}`)}</p>
            {category.id==='competence' && result.data.trainingPoints>0 && <p>{t('safetyMaturity.trainingCredit',{points:result.data.trainingPoints})}</p>}
            {category.resources.map(resource => <Link key={resource.id} href={`/work-hub/library/${resource.id}`} className="safety-program-link">{resource.title}</Link>)}
            {!!category.requirements?.length && <details className="mt-4 border-t pt-3">
              <summary className="cursor-pointer">{t("workHubLibrary.training")} ({category.requirements.length})</summary>
              {category.requirements.map(requirement => <section key={requirement.id} className="mt-4 space-y-2 border-t pt-3">
              <h3 className="font-semibold">{requirement.id} — {requirement.title}</h3>
              <p className="text-sm">{requirement.applicability}</p>
              {requirement.trainingRequirement&&<p>{t('trainingPolicy.coverage',{...requirement.trainingRequirement,familyId:requirement.id})}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {requirement.resources.filter(resource => resource.type==='training').map(resource => <TrainingActions key={resource.id} itemId={resource.id} canManage={isWorkHubAdmin(user)} appearance="links"/>)}
              </div>
              </section>)}
            </details>}
          </CardContent>
        </Card>)}
      </div>
    </>}
  </>;
}
