import { DollarSign } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type AnalyticsPipelineSegment = {
  key: string;
  label: string;
  caption: string;
  count: number;
  total: number;
  href: string;
};

type Props = {
  title: string;
  segments: AnalyticsPipelineSegment[];
  formatFullCurrency: (value: number) => string;
  ticketCountLabel: (count: number) => string;
  iconStyle?: React.CSSProperties;
  testId?: string;
};

export default function AnalyticsPipelineCard({
  title,
  segments,
  formatFullCurrency,
  ticketCountLabel,
  iconStyle,
  testId = "card-analytics-pipeline",
}: Props) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <DollarSign className="w-5 h-5" style={iconStyle} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          {segments.map((segment) => (
            <Link
              key={segment.key}
              href={segment.href}
              className="rounded-lg border border-border/60 bg-muted/20 p-4 hover:bg-muted/40 transition-colors"
              data-testid={`pipeline-segment-${segment.key}`}
            >
              <p className="text-xs font-medium text-gray-700">{segment.label}</p>
              <p className="text-xl font-bold mt-1">{formatFullCurrency(segment.total)}</p>
              <p className="text-xs text-muted-foreground mt-1">{ticketCountLabel(segment.count)}</p>
              <p className="text-[11px] text-muted-foreground mt-2">{segment.caption}</p>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
