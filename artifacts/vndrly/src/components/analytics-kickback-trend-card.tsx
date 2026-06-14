import { AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import {
  ANALYTICS_BAR_SIZE,
  ANALYTICS_VERTICAL_CHART_HEIGHT,
} from "@/lib/analytics-bar-chart";

export type KickbackTrendRow = {
  month: string;
  kickbackCount: number;
  ticketCount: number;
  kickbackRate: number;
};

type Props = {
  title: string;
  rows: KickbackTrendRow[];
  emptyMessage: string;
  caption: string;
  kickedBackLabel: string;
  kickbackRateLabel: string;
  totalTicketsLabel: string;
  iconStyle?: React.CSSProperties;
  testId?: string;
};

export default function AnalyticsKickbackTrendCard({
  title,
  rows,
  emptyMessage,
  caption,
  kickedBackLabel,
  kickbackRateLabel,
  totalTicketsLabel,
  iconStyle,
  testId = "card-kickback-trend",
}: Props) {
  const hasData = rows.some((row) => row.kickbackCount > 0 || row.ticketCount > 0);

  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5" style={iconStyle} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <>
            <ResponsiveContainer width="100%" height={ANALYTICS_VERTICAL_CHART_HEIGHT}>
              <BarChart data={rows.map((row) => ({ ...row, color: "red" as const }))}>
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: "#ccc", fillOpacity: 0.5 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0]?.payload as KickbackTrendRow;
                    return (
                      <div className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm">
                        <p className="font-medium">{label}</p>
                        <p>{kickedBackLabel}: {row.kickbackCount}</p>
                        <p>{kickbackRateLabel}: {row.kickbackRate}%</p>
                        <p className="text-muted-foreground">{totalTicketsLabel}: {row.ticketCount}</p>
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="kickbackCount"
                  name={kickedBackLabel}
                  barSize={ANALYTICS_BAR_SIZE}
                  shape={(props: object) => <VerticalPillBarShape {...props} flatBottom />}
                />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-muted-foreground text-center mt-2">{caption}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm text-center py-8">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
