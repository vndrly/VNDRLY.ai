import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PngPillButton } from "@/components/png-pill-rollover";
import ImagePill from "@/components/image-pill";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, RotateCcw, Save } from "lucide-react";
import { useBrand } from "@/hooks/use-brand";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface QbMappingItem {
  lineType: string;
  label: string;
  defaultAccountName: string;
  defaultAccountNumber: string;
  accountName: string;
  accountNumber: string;
  isOverride: boolean;
  overrideId: number | null;
}

interface PartnerOption {
  id: number;
  name: string;
}

export interface VendorQbAccountMappingCardProps {
  vendorId: number;
}

export function VendorQbAccountMappingCard({
  vendorId,
}: VendorQbAccountMappingCardProps): ReactElement {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const { toast } = useToast();

  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [partners, setPartners] = useState<PartnerOption[]>([]);
  const [items, setItems] = useState<QbMappingItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [edits, setEdits] = useState<
    Record<string, { accountName: string; accountNumber: string }>
  >({});

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/partners`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((j: PartnerOption[]) => {
        if (active) setPartners(Array.isArray(j) ? j : []);
      })
      .catch(() => {
        /* non-fatal */
      });
    return () => {
      active = false;
    };
  }, []);

  const reload = useCallback(() => {
    const params = new URLSearchParams();
    if (partnerId != null) params.set("partnerId", String(partnerId));
    const url = `${API_BASE}/api/reports/vendor/${vendorId}/qb-account-mapping${
      params.toString() ? `?${params}` : ""
    }`;
    setLoading(true);
    setErr(null);
    fetch(url, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { items: QbMappingItem[] }) => {
        setItems(j.items);
        const initial: Record<
          string,
          { accountName: string; accountNumber: string }
        > = {};
        for (const it of j.items) {
          initial[it.lineType] = {
            accountName: it.accountName,
            accountNumber: it.accountNumber,
          };
        }
        setEdits(initial);
      })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [partnerId, vendorId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const saveRow = async (lineType: string): Promise<void> => {
    const edit = edits[lineType];
    if (!edit) return;
    setSavingKey(lineType);
    try {
      const res = await fetch(
        `${API_BASE}/api/reports/vendor/${vendorId}/qb-account-mapping`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partnerId,
            lineType,
            accountName: edit.accountName.trim(),
            accountNumber: edit.accountNumber.trim() || null,
          }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      toast({ title: t("reports.vendorQbMapping.saved") });
      reload();
    } catch (e) {
      toast({
        title: t("reports.vendorQbMapping.saveError"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSavingKey(null);
    }
  };

  const resetRow = async (item: QbMappingItem): Promise<void> => {
    if (!item.isOverride || item.overrideId == null) {
      setEdits((prev) => ({
        ...prev,
        [item.lineType]: {
          accountName: item.defaultAccountName,
          accountNumber: item.defaultAccountNumber,
        },
      }));
      return;
    }
    setSavingKey(item.lineType);
    try {
      const res = await fetch(
        `${API_BASE}/api/reports/vendor/${vendorId}/qb-account-mapping/${item.overrideId}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      toast({ title: t("reports.vendorQbMapping.reset") });
      reload();
    } catch (e) {
      toast({
        title: t("reports.vendorQbMapping.saveError"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSavingKey(null);
    }
  };

  const partnerLabel = useMemo(() => {
    if (partnerId == null) return t("reports.vendorQbMapping.allPartners");
    return (
      partners.find((p) => p.id === partnerId)?.name ??
      t("reports.vendorQbMapping.partnerId", { id: partnerId })
    );
  }, [partnerId, partners, t]);

  return (
    <Card data-testid="card-vendor-qb-mapping">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BookOpen className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
          {t("reports.vendorQbMapping.title")}
        </CardTitle>
        <CardDescription>{t("reports.vendorQbMapping.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-sm">
          <Select
            value={partnerId == null ? "all" : String(partnerId)}
            onValueChange={(v) =>
              setPartnerId(v === "all" ? null : Number(v))
            }
          >
            <SelectTrigger data-testid="select-vendor-qb-partner">
              <SelectValue placeholder={partnerLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                {t("reports.vendorQbMapping.allPartners")}
              </SelectItem>
              {partners.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {loading && <Skeleton className="h-48 w-full" />}
        {err && (
          <p className="text-sm text-destructive" data-testid="text-vendor-qb-error">
            {err}
          </p>
        )}

        {items && !loading && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.qbMapping.col.lineType")}</TableHead>
                  <TableHead>{t("reports.qbMapping.col.accountName")}</TableHead>
                  <TableHead>{t("reports.qbMapping.col.accountNumber")}</TableHead>
                  <TableHead>{t("reports.qbMapping.col.source")}</TableHead>
                  <TableHead className="w-40">
                    {t("reports.qbMapping.col.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const edit = edits[item.lineType] ?? {
                    accountName: item.accountName,
                    accountNumber: item.accountNumber,
                  };
                  const dirty =
                    edit.accountName !== item.accountName ||
                    edit.accountNumber !== item.accountNumber;
                  return (
                    <TableRow key={item.lineType}>
                      <TableCell className="font-medium">{item.label}</TableCell>
                      <TableCell>
                        <Input
                          value={edit.accountName}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [item.lineType]: {
                                ...edit,
                                accountName: e.target.value,
                              },
                            }))
                          }
                          data-testid={`input-qb-name-${item.lineType}`}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={edit.accountNumber}
                          onChange={(e) =>
                            setEdits((prev) => ({
                              ...prev,
                              [item.lineType]: {
                                ...edit,
                                accountNumber: e.target.value,
                              },
                            }))
                          }
                          data-testid={`input-qb-number-${item.lineType}`}
                        />
                      </TableCell>
                      <TableCell>
                        <ImagePill
                          color={item.isOverride ? "amber" : "blue"}
                        >
                          {item.isOverride
                            ? t("reports.qbMapping.source.override")
                            : t("reports.qbMapping.source.default")}
                        </ImagePill>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <PngPillButton
                            color="green"
                            size="sm"
                            disabled={!dirty || savingKey === item.lineType}
                            onClick={() => void saveRow(item.lineType)}
                            data-testid={`button-save-qb-${item.lineType}`}
                          >
                            <Save className="h-3.5 w-3.5 mr-1" />
                            {t("reports.vendorQbMapping.saveBtn")}
                          </PngPillButton>
                          {(item.isOverride || dirty) && (
                            <PngPillButton
                              color="blue"
                              size="sm"
                              disabled={savingKey === item.lineType}
                              onClick={() => void resetRow(item)}
                              data-testid={`button-reset-qb-${item.lineType}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5 mr-1" />
                              {t("reports.vendorQbMapping.resetBtn")}
                            </PngPillButton>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
