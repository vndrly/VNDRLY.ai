import { Clock } from "lucide-react";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VerticalPillBarShape } from "@/components/vertical-pill-bar-shape";
import {
  ANALYTICS_BAR_SIZE,
  ANALYTICS_VERTICAL_CHART_HEIGHT,
} from "@/lib/analytics-bar-chart";

export type InvoiceAgingBucket = {
  bucket: string;
  total: number;
  color: "green" | "blue" | "amber" | "red";
};

export type InvoiceAgingCounterparty = {
  id: number;
  name: string | null;
  total: number;
  href: string;
  fallbackLabel: string;
};

type Props = {
  title: string;
  totals: { total: number };
  buckets: InvoiceAgingBucket[];
  counterparties: InvoiceAgingCounterparty[];
  counterpartyCaption: string;
  emptyMessage: string;
  viewLinkHref: string;
  viewLinkLabel: string;
  formatCurrency: (value: number) => string;
  formatFullCurrency: (value: number) => string;
  iconStyle?: React.CSSProperties;
  testId?: string;
};

export default function AnalyticsInvoiceAgingCard({
  title,
  totals,
  buckets,
  counterparties,
  counterpartyCaption,
  emptyMessage,
  viewLinkHref,
  viewLinkLabel,
  formatCurrency,
  formatFullCurrency,
  iconStyle,
  testId = "card-invoice-aging",
}: Props) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Clock className="w-5 h-5" style={iconStyle} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {totals.total > 0 ? (
          <>
            <div className="flex justify-between items-baseline mb-3">
              <p className="text-2xl font-bold">{formatFullCurrency(totals.total)}</p>
              <Link href={viewLinkHref} className="text-xs text-[var(--brand-primary)] hover:underline">
                {viewLinkLabel}
              </Link>
            </div>
            <ResponsiveContainer width="100%" height={ANALYTICS_VERTICAL_CHART_HEIGHT}>
              <BarChart data={buckets}>
                <XAxis
                  dataKey="bucket"
                  tick={{ fontSize: 10 }}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={50}
                />
                <YAxis tickFormatter={(v) => formatCurrency(v)} width={56} />
                <Tooltip
                  cursor={{ fill: "#ccc", fillOpacity: 0.5 }}
                  formatter={(value: number) => formatFullCurrency(value)}
                />
                <Bar
                  dataKey="total"
                  barSize={ANALYTICS_BAR_SIZE}
                  shape={(props: object) => <VerticalPillBarShape {...props} flatBottom />}
                />
              </BarChart>
            </ResponsiveContainer>
            {counterparties.length > 0 && (
              <div className="mt-4 space-y-1">
                {counterparties.map((row) => (
                  <div key={row.id} className="flex justify-between text-sm">
                    <Link
                      href={row.href}
                      className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors truncate pr-2"
                    >
                      {row.name ?? row.fallbackLabel}
                    </Link>
                    <span className="text-muted-foreground shrink-0">{formatFullCurrency(row.total)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">{counterpartyCaption}</p>
          </>
        ) : (
          <p className="text-muted-foreground text-sm text-center py-8">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
