import { MapPin } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HorizontalPillBarShape } from "@/components/horizontal-pill-bar-shape";
import { type PillColor } from "@/components/status-pill-assets";
import {
  ANALYTICS_BAR_SIZE,
  analyticsHorizontalChartHeight,
} from "@/lib/analytics-bar-chart";

const afePillColors: PillColor[] = ["blue", "green", "amber", "grey", "red"];

type Row = { afe: string; total: number };

type Props = {
  title: string;
  caption: string;
  emptyMessage: string;
  valueLabel: string;
  rows: Row[];
  formatCurrency: (value: number) => string;
  formatFullCurrency: (value: number) => string;
  iconStyle?: React.CSSProperties;
  testId?: string;
};

export default function AnalyticsSpendByAfeCard({
  title,
  caption,
  emptyMessage,
  valueLabel,
  rows,
  formatCurrency,
  formatFullCurrency,
  iconStyle,
  testId = "card-spend-by-afe",
}: Props) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <MapPin className="w-5 h-5" style={iconStyle} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={analyticsHorizontalChartHeight(rows.length)}>
              <BarChart
                data={rows.map((row, idx) => ({
                  ...row,
                  color: afePillColors[idx % afePillColors.length],
                }))}
                layout="vertical"
              >
                <XAxis type="number" tickFormatter={(v) => formatCurrency(v)} />
                <YAxis type="category" dataKey="afe" tick={{ fontSize: 11 }} width={120} />
                <Tooltip
                  cursor={{ fill: "#ccc", fillOpacity: 0.5 }}
                  formatter={(value: number) => formatFullCurrency(value)}
                />
                <Bar
                  dataKey="total"
                  name={valueLabel}
                  barSize={ANALYTICS_BAR_SIZE}
                  shape={(props: object) => <HorizontalPillBarShape {...props} flatLeft />}
                />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground mt-3">{caption}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm text-center py-8">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
