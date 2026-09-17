import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CARD_ICON_CLASS, CARD_ICON_ROW_CLASS, CARD_MINI_CONTENT_CLASS } from "@/components/ui/card";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import MiniCardDialogContent from "@/components/mini-card-dialog-content";

export type GateLogStatDetail = {
  id: string | number;
  title: string;
  subtitle?: string;
};

export default function GateLogStatCard({
  icon: Icon,
  label,
  value,
  definition,
  timeWindow,
  details,
  iconColor,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  definition: string;
  timeWindow: string;
  details: GateLogStatDetail[];
  iconColor: string;
  testId: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button type="button" className="block w-full text-left" aria-label={`View ${label} details`}>
          <Card className="h-full transition-shadow hover:shadow-md" data-testid={testId}>
            <CardContent className={CARD_MINI_CONTENT_CLASS}>
              <div className={CARD_ICON_ROW_CLASS}>
                <Icon className={CARD_ICON_CLASS} style={{ color: iconColor }} />
                <span className="text-xs font-medium text-gray-700">{label}</span>
              </div>
              <p className="mt-auto text-center text-lg font-bold">{value}</p>
            </CardContent>
          </Card>
        </button>
      </DialogTrigger>
      <MiniCardDialogContent
        icon={Icon}
        label={label}
        definition={definition}
        iconColor={iconColor}
        className="max-h-[80vh] sm:max-w-lg"
      >
        <p className="text-xs font-medium text-muted-foreground">{timeWindow}</p>
        <div className="space-y-2">
          {details.length ? details.map((detail) => (
            <div key={detail.id} className="rounded-xl border-2 border-[color:var(--brand-primary)] bg-white p-3">
              <p className="font-medium text-foreground">{detail.title}</p>
              {detail.subtitle ? <p className="text-xs text-muted-foreground">{detail.subtitle}</p> : null}
            </div>
          )) : <p className="text-sm text-muted-foreground">No matching records.</p>}
        </div>
      </MiniCardDialogContent>
    </Dialog>
  );
}
