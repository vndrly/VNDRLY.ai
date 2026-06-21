import { useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import SphereBackButton from "@/components/sphere-back-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useToast } from "@/hooks/use-toast";
import {
  completeSafetyTrainingModule,
  useSafetyTrainingStatus,
} from "@/lib/safety-api";
import { translateApiError } from "@/lib/api-error";

export default function SafetyTrainingPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useSafetyTrainingStatus();
  const [completingId, setCompletingId] = useState<number | null>(null);

  const markComplete = async (moduleId: number) => {
    setCompletingId(moduleId);
    try {
      await completeSafetyTrainingModule(moduleId);
      await queryClient.invalidateQueries({ queryKey: ["safety-training-status"] });
      toast({ title: t("safety.trainingCompleteToast") });
    } catch (err) {
      toast({
        title: t("safety.trainingCompleteFailed"),
        description: translateApiError(err, t, String(err)),
        variant: "destructive",
      });
    } finally {
      setCompletingId(null);
    }
  };

  return (
    <div className="space-y-6 max-w-xl" data-testid="safety-training-page">
      <div className="flex items-center gap-4">
        <Link href="/" className="group inline-flex items-center" aria-label="Back">
          <SphereBackButton size={40} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("safety.trainingPageTitle")}</h1>
          <p className="text-muted-foreground text-sm">{t("safety.trainingPageSubtitle")}</p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground text-sm">{t("common.loading", { defaultValue: "Loading…" })}</p>
      ) : !data || data.incompleteModules.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {t("safety.trainingAllComplete")}
          </CardContent>
        </Card>
      ) : (
        data.incompleteModules.map((mod) => (
          <Card key={mod.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{mod.title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {mod.description ? (
                <p className="text-sm text-muted-foreground">{mod.description}</p>
              ) : null}
              <a
                href={mod.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-medium text-[var(--brand-primary)] hover:underline"
                data-testid={`link-training-video-${mod.id}`}
              >
                <ExternalLink className="h-4 w-4" />
                {t("safety.trainingWatchVideo")}
              </a>
              <PngPillButton
                type="button"
                color="green"
                onClick={() => void markComplete(mod.id)}
                disabled={completingId === mod.id}
                data-testid={`button-complete-training-${mod.id}`}
              >
                {completingId === mod.id
                  ? t("common.saving", { defaultValue: "Saving…" })
                  : t("safety.trainingMarkComplete")}
              </PngPillButton>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
