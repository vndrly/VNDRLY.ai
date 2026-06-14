import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { TexturedPie, TexturedPieLegend, type PieColor } from "@/components/textured-pie";
import { HorizontalPillBarShape } from "@/components/horizontal-pill-bar-shape";
import {
  ANALYTICS_BAR_SIZE,
  analyticsHorizontalChartHeight,
} from "@/lib/analytics-bar-chart";
import type { AnalyticsLineTypeBucket } from "@workspace/db/line-types";

export type SpendByLineTypeItem = {
  type: string;
  total: number;
  label?: string;
};

const LINE_TYPE_COLORS: Record<AnalyticsLineTypeBucket, PieColor> = {
  labor: "green",
  equipment: "amber",
  materials: "red",
  mileage: "blue",
  per_diem: "grey",
  markup: "amber",
  discount: "red",
  other: "grey",
};

const BAR_CHART_THRESHOLD = 5;

type Props = {
  items: SpendByLineTypeItem[];
  formatCurrency: (value: number) => string;
  formatFullCurrency: (value: number) => string;
  emptyMessage: string;
  valueLabel?: string;
};

export default function SpendByLineTypeChart({
  items,
  formatCurrency,
  formatFullCurrency,
  emptyMessage,
  valueLabel,
}: Props) {
  const { t } = useTranslation();

  const chartData = useMemo(() => {
    return items
      .filter((item) => item.total > 0)
      .map((item) => {
        const bucket = item.type as AnalyticsLineTypeBucket;
        const name =
          t(`analyticsLineTypes.${bucket}`, {
            defaultValue: item.label ?? item.type,
          });
        return {
          type: bucket,
          name,
          total: item.total,
          color: LINE_TYPE_COLORS[bucket] ?? ("grey" as PieColor),
        };
      });
  }, [items, t]);

  if (chartData.length === 0) {
    return <p className="text-muted-foreground text-sm text-center py-8">{emptyMessage}</p>;
  }

  const useBarChart = chartData.length > BAR_CHART_THRESHOLD;

  if (useBarChart) {
    return (
      <ResponsiveContainer width="100%" height={analyticsHorizontalChartHeight(chartData.length)} data-testid="spend-by-line-type-bar">
        <BarChart data={chartData} layout="vertical">
          <XAxis type="number" tickFormatter={(value) => formatCurrency(value)} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
          <Tooltip
            cursor={{ fill: "#ccc", fillOpacity: 0.5 }}
            formatter={(value: number) => formatFullCurrency(value)}
          />
          <Bar
            dataKey="total"
            name={valueLabel ?? t("partnerAnalytics.cost", { defaultValue: "Cost" })}
            barSize={ANALYTICS_BAR_SIZE}
            shape={(props: object) => <HorizontalPillBarShape {...props} flatLeft />}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  const pieData = chartData.map(({ name, total, color }) => ({ name, value: total, color }));

  return (
    <div className="flex flex-col items-center gap-3 py-2" data-testid="spend-by-line-type-pie">
      <TexturedPie data={pieData} size={240} formatValue={(value) => formatCurrency(value)} />
      <TexturedPieLegend data={pieData} formatValue={(value) => formatCurrency(value)} />
    </div>
  );
}
