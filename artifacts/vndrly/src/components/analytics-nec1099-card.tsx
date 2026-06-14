import { Receipt } from "lucide-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type Nec1099EntityRow = {
  id: number;
  name: string;
  totalPaid: number;
  sharedEinWarning?: boolean;
};

type Props = {
  title: string;
  year: number;
  threshold: number;
  entityCount: number;
  totalPaid: number;
  entities: Nec1099EntityRow[];
  entityColumnLabel: string;
  box1Label: string;
  entityCountLabel: string;
  totalPaidLabel: string;
  emptyMessage: string;
  viewReportsLabel: string;
  sharedEinWarningTitle?: string;
  formatFullCurrency: (value: number) => string;
  entityHref: (id: number) => string;
  iconStyle?: React.CSSProperties;
  testId?: string;
};

export default function AnalyticsNec1099Card({
  title,
  threshold,
  entityCount,
  totalPaid,
  entities,
  entityColumnLabel,
  box1Label,
  entityCountLabel,
  totalPaidLabel,
  emptyMessage,
  viewReportsLabel,
  sharedEinWarningTitle,
  formatFullCurrency,
  entityHref,
  iconStyle,
  testId = "card-nec1099-exposure",
}: Props) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Receipt className="w-5 h-5" style={iconStyle} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="px-6 pb-4">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <p className="text-xs text-muted-foreground">{entityCountLabel}</p>
              <p className="text-xl font-bold">{entityCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">{totalPaidLabel}</p>
              <p className="text-xl font-bold">{formatFullCurrency(totalPaid)}</p>
            </div>
          </div>
          <Link href="/reports" className="text-xs text-[var(--brand-primary)] hover:underline">
            {viewReportsLabel}
          </Link>
        </div>
        {entities.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{entityColumnLabel}</TableHead>
                <TableHead className="text-right">{box1Label}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entities.map((entity) => (
                <TableRow key={entity.id}>
                  <TableCell>
                    <Link
                      href={entityHref(entity.id)}
                      className="font-medium text-gray-700 hover:text-[var(--brand-primary)] transition-colors"
                    >
                      {entity.name}
                      {entity.sharedEinWarning && sharedEinWarningTitle && (
                        <span className="ml-1 text-amber-600" title={sharedEinWarningTitle}>
                          *
                        </span>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatFullCurrency(entity.totalPaid)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-muted-foreground text-sm text-center py-8 px-4">{emptyMessage}</p>
        )}
      </CardContent>
    </Card>
  );
}
