// IRS FIRE transmitter settings (Task #415).
//
// Admin-only edit surface for the singleton fire_transmitter_settings
// row used as the source of truth for the T record on every IRS 1099
// FIRE submission. See artifacts/api-server/src/routes/
// fireTransmitterSettings.ts for the matching CRUD route and
// lib/reports/transmitter-settings.ts for the env-var fallback that
// kicks in when no row has been saved yet.

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetFireTransmitterSettings,
  useUpdateFireTransmitterSettings,
  useListFireTransmitterSettingsHistory,
  getGetFireTransmitterSettingsQueryKey,
  getListFireTransmitterSettingsHistoryQueryKey,
  type FireTransmitterSettingsHistoryEntry,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PillButton } from "@/components/pill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatPhone, handlePhoneInput, stripPhone } from "@/lib/utils";

type FormState = {
  tcc: string;
  ein: string;
  name: string;
  address: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
};

const EMPTY_FORM: FormState = {
  tcc: "",
  ein: "",
  name: "",
  address: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
};

// Field labels surfaced in the "Missing required values" banner. Keys
// match the names returned in the API's `missing` array, which mirror
// the column names on fire_transmitter_settings.
const FIELD_LABELS: Record<keyof FormState, string> = {
  tcc: "TCC",
  ein: "EIN",
  name: "Transmitter name",
  address: "Address",
  contactName: "Contact name",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
};

export default function Admin1099Transmitter() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useGetFireTransmitterSettings({
    query: {
      enabled: user?.role === "admin",
      queryKey: getGetFireTransmitterSettingsQueryKey(),
    },
  });
  const updateSettings = useUpdateFireTransmitterSettings();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!settings || hydrated) return;
    setForm({
      tcc: settings.tcc ?? "",
      ein: settings.ein ?? "",
      name: settings.name ?? "",
      address: settings.address ?? "",
      contactName: settings.contactName ?? "",
      contactEmail: settings.contactEmail ?? "",
      contactPhone: settings.contactPhone
        ? formatPhone(settings.contactPhone)
        : "",
    });
    setHydrated(true);
  }, [settings, hydrated]);

  if (user?.role !== "admin") {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Admin role required.
      </div>
    );
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings.mutate(
      {
        data: {
          tcc: form.tcc.trim(),
          ein: form.ein.trim(),
          name: form.name.trim(),
          address: form.address.trim(),
          contactName: form.contactName.trim(),
          contactEmail: form.contactEmail.trim(),
          contactPhone: stripPhone(form.contactPhone),
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetFireTransmitterSettingsQueryKey(),
          });
          // Refresh the history panel so the just-saved change appears
          // without a manual reload.
          queryClient.invalidateQueries({
            queryKey: getListFireTransmitterSettingsHistoryQueryKey(),
          });
          toast({ title: "Transmitter settings saved" });
        },
        onError: (err) => {
          // The route returns a structured `missing` array on
          // validation failure but it's wrapped inside an ApiError
          // whose `message` is the JSON body — surface a generic toast
          // and rely on the missing-fields banner that re-renders from
          // the next GET to point the operator at what to fix.
          const message =
            err instanceof Error ? err.message : "Failed to save settings";
          toast({
            title: "Failed to save",
            description: message.slice(0, 300),
            variant: "destructive",
          });
        },
      },
    );
  };

  const missing = settings?.missing ?? [];
  const updatedAt = settings?.updatedAt
    ? new Date(settings.updatedAt).toLocaleString()
    : null;
  const updatedBy =
    settings?.updatedByName?.trim() ||
    settings?.updatedByEmail?.trim() ||
    null;
  const lastSavedLine = updatedAt
    ? updatedBy
      ? `Last saved ${updatedAt} by ${updatedBy}`
      : `Last saved ${updatedAt}`
    : "Never saved — using env-var fallback.";

  return (
    <div className="container mx-auto p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">1099 FIRE transmitter</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Used for the IRS T record on every 1099 FIRE submission. Every
          field is required and the address must parse as
          {" "}
          <code className="text-xs">Street, City, ST 12345</code>. Real
          (non-test) FIRE submissions are blocked until every field on
          this page is saved.
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-6 space-y-3">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </CardContent>
        </Card>
      ) : (
        <>
          {missing.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <div className="font-medium mb-1">
                Missing required values
              </div>
              <div>
                Real (non-test) FIRE submissions are blocked until these
                fields are filled in:{" "}
                <span className="font-medium">
                  {missing
                    .map(
                      (m) =>
                        FIELD_LABELS[m as keyof FormState] ?? m,
                    )
                    .join(", ")}
                </span>
                .
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Transmitter info</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="tcc">TCC (5 chars)</Label>
                    <Input
                      id="tcc"
                      value={form.tcc}
                      onChange={(e) =>
                        setForm({ ...form, tcc: e.target.value.toUpperCase() })
                      }
                      maxLength={5}
                      placeholder="AB123"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ein">EIN</Label>
                    <Input
                      id="ein"
                      value={form.ein}
                      onChange={(e) => setForm({ ...form, ein: e.target.value })}
                      placeholder="12-3456789"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="name">Transmitter name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="address">Address</Label>
                  <Input
                    id="address"
                    value={form.address}
                    onChange={(e) =>
                      setForm({ ...form, address: e.target.value })
                    }
                    placeholder="123 Main St, Springfield, IL 62701"
                  />
                  <p className="text-xs text-muted-foreground">
                    Single line, comma-separated:{" "}
                    <code>Street, City, ST 12345</code>.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="contactName">Contact name</Label>
                    <Input
                      id="contactName"
                      value={form.contactName}
                      onChange={(e) =>
                        setForm({ ...form, contactName: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="contactEmail">Contact email</Label>
                    <Input
                      id="contactEmail"
                      type="email"
                      value={form.contactEmail}
                      onChange={(e) =>
                        setForm({ ...form, contactEmail: e.target.value })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="contactPhone">Contact phone</Label>
                  <Input
                    id="contactPhone"
                    value={form.contactPhone}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        contactPhone: handlePhoneInput(e.target.value),
                      })
                    }
                    placeholder="(555) 555-5555"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div
                    className="text-xs text-muted-foreground"
                    data-testid="text-last-saved"
                  >
                    {lastSavedLine}
                  </div>
                  <PillButton type="submit" color="blue" disabled={updateSettings.isPending}>
                    {updateSettings.isPending ? "Saving…" : "Save"}
                  </PillButton>
                </div>
              </form>
            </CardContent>
          </Card>

          <HistoryPanel />
        </>
      )}
    </div>
  );
}

// ── History panel ────────────────────────────────────────────────
//
// Shows recent rows from `fire_transmitter_settings_audit_log` so an
// admin can see "who changed our IRS TCC last week, and from what to
// what?" without dropping into psql. The audit row is per-save (not
// per-field), so each entry can carry one or more
// `{ before → after }` lines for the columns that actually changed.

const HISTORY_PAGE_SIZE = 20;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function renderDiffValue(value: string | null): React.ReactNode {
  if (value === null || value === "") {
    return <span className="text-muted-foreground italic">empty</span>;
  }
  return <span className="font-mono break-all">{value}</span>;
}

function HistoryEntryCard({
  entry,
}: {
  entry: FireTransmitterSettingsHistoryEntry;
}) {
  const changeRows = Object.entries(entry.changes);
  return (
    <div
      className="border rounded-md p-3 space-y-2"
      data-testid={`row-transmitter-history-${entry.id}`}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="text-sm">
          <span
            className="font-medium"
            data-testid={`text-transmitter-history-actor-${entry.id}`}
          >
            {entry.actorDisplayName ?? "(deleted user)"}
          </span>
          {entry.actorEmail && (
            <span className="text-muted-foreground ml-2 text-xs">
              {entry.actorEmail}
            </span>
          )}
          <Badge variant="secondary" className="ml-2 text-xs">
            {entry.actorRole}
          </Badge>
        </div>
        <div
          className="text-xs text-muted-foreground whitespace-nowrap"
          data-testid={`text-transmitter-history-when-${entry.id}`}
        >
          {formatDateTime(entry.createdAt)}
        </div>
      </div>

      {changeRows.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No field-level changes were captured for this save.
        </div>
      ) : (
        <div className="space-y-1">
          {changeRows.map(([field, diff]) => (
            <div
              key={field}
              className="text-xs grid grid-cols-[7rem_1fr] gap-2 items-baseline"
              data-testid={`row-transmitter-history-change-${entry.id}-${field}`}
            >
              <div className="font-medium">
                {FIELD_LABELS[field as keyof FormState] ?? field}
              </div>
              <div className="break-all">
                {renderDiffValue(diff.before)}
                <span className="mx-2 text-muted-foreground">→</span>
                {renderDiffValue(diff.after)}
              </div>
            </div>
          ))}
        </div>
      )}

      {(entry.actorIp || entry.actorUserAgent) && (
        <div className="text-[11px] text-muted-foreground font-mono break-all pt-1 border-t">
          {entry.actorIp ?? ""}
          {entry.actorIp && entry.actorUserAgent ? " — " : ""}
          {entry.actorUserAgent ?? ""}
        </div>
      )}
    </div>
  );
}

function HistoryPanel() {
  const [page, setPage] = useState(0);
  const offset = page * HISTORY_PAGE_SIZE;
  const params = { limit: HISTORY_PAGE_SIZE, offset };
  const { data, isLoading, isError, error, isFetching } =
    useListFireTransmitterSettingsHistory(params, {
      query: {
        queryKey: getListFireTransmitterSettingsHistoryQueryKey(params),
      },
    });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pageCount = total === 0 ? 1 : Math.ceil(total / HISTORY_PAGE_SIZE);

  return (
    <Card data-testid="card-transmitter-history">
      <CardHeader>
        <CardTitle className="text-base">Change history</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <div
            className="text-sm text-destructive"
            data-testid="text-transmitter-history-error"
          >
            Failed to load history:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </div>
        )}

        {!isLoading && !isError && items.length === 0 && (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-transmitter-history-empty"
          >
            No transmitter info changes have been recorded yet.
          </div>
        )}

        {!isLoading && !isError && items.length > 0 && (
          <>
            <div className="space-y-3" data-testid="list-transmitter-history">
              {items.map((entry) => (
                <HistoryEntryCard key={entry.id} entry={entry} />
              ))}
            </div>

            {total > HISTORY_PAGE_SIZE && (
              <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
                <div data-testid="text-transmitter-history-page-summary">
                  Showing {offset + 1}–{Math.min(offset + items.length, total)}{" "}
                  of {total}
                </div>
                <div className="flex items-center gap-2">
                  <PillButton
                    color="image"
                    disabled={page === 0 || isFetching}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    data-testid="button-transmitter-history-prev"
                  >
                    Previous
                  </PillButton>
                  <span data-testid="text-transmitter-history-page-indicator">
                    Page {page + 1} of {pageCount}
                  </span>
                  <PillButton
                    color="image"
                    disabled={page + 1 >= pageCount || isFetching}
                    onClick={() => setPage((p) => p + 1)}
                    data-testid="button-transmitter-history-next"
                  >
                    Next
                  </PillButton>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
