import type { LucideIcon } from "lucide-react";
import { Link } from "wouter";

import {
  Card,
  CardContent,
  CARD_ICON_CLASS,
  CARD_ICON_ROW_CLASS,
  CARD_MINI_CONTENT_CLASS,
} from "@/components/ui/card";
import {
  Dialog,
  DialogTrigger,
} from "@/components/ui/dialog";
import PngPill from "@/components/png-pill-rollover";
import MiniCardDialogContent from "@/components/mini-card-dialog-content";

export default function DashboardStatCard({
  icon: Icon,
  label,
  value,
  definition,
  destination,
  iconColor,
  testId,
  valueTestId,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  definition: string;
  destination: string;
  iconColor: string;
  testId: string;
  valueTestId?: string;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="block h-full w-full text-left"
          aria-label={`View ${label} details`}
        >
          <Card className="h-full transition-shadow hover:shadow-md" data-testid={testId}>
            <CardContent className={CARD_MINI_CONTENT_CLASS}>
              <div className={CARD_ICON_ROW_CLASS}>
                <Icon className={CARD_ICON_CLASS} style={{ color: iconColor }} />
                <span className="text-xs font-medium text-gray-700">{label}</span>
              </div>
              <p className="mt-auto text-center text-lg font-bold" data-testid={valueTestId}>{value}</p>
            </CardContent>
          </Card>
        </button>
      </DialogTrigger>
      <MiniCardDialogContent
        icon={Icon}
        label={label}
        definition={definition}
        iconColor={iconColor}
        className="sm:max-w-md"
      >
        <div className="rounded-xl border bg-white p-4 text-center">
          <p className="text-3xl font-bold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">Matching records in your current company</p>
        </div>
        <Link href={destination} className="mx-auto inline-flex">
          <PngPill color="brand" interactive>View all</PngPill>
        </Link>
      </MiniCardDialogContent>
    </Dialog>
  );
}
