import { CardHeading } from "@/components/ui/card-heading";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type {
  AdminCanonicalService,
  AdminServiceMappingRow,
  AdminServiceMappingResult,
  AdminCanonicalServiceInput,
} from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

const base = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/admin`;
type Page<T> = { items: T[]; total: number };
type Write = {
  path: string;
  method: "POST" | "PATCH" | "DELETE";
  body?: unknown;
};
async function api<T>(path: string, write?: Write): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    credentials: "include",
    ...(write
      ? {
          method: write.method,
          headers: { "Content-Type": "application/json" },
          ...(write.body ? { body: JSON.stringify(write.body) } : {}),
        }
      : {}),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.code ?? "service_mapping.unavailable");
  return result;
}

function ReviewItem({
  row,
  services,
  busy,
  write,
}: {
  row: AdminServiceMappingRow;
  services: AdminCanonicalService[];
  busy: boolean;
  write: (value: Write, confirm?: boolean) => void;
}) {
  const { t } = useTranslation();
  const label = (key: string) => t(`serviceMappings.${key}`);
  const [reason, setReason] = useState("");
  const [concept, setConcept] = useState(String(row.canonicalServiceId ?? ""));
  const [alias, setAlias] = useState("");
  const review = (action: "approve" | "reject" | "remap") =>
    write(
      {
        path: `/service-mappings/${row.id}/review`,
        method: "POST",
        body: {
          action,
          reason: reason.trim(),
          ...(action === "remap"
            ? { canonicalServiceId: Number(concept) }
            : {}),
        },
      },
      action === "remap",
    );
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <CardHeading as="h2" className="font-semibold">
          {row.subject?.name ?? `${row.subjectType} #${row.subjectId}`}
        </CardHeading>
        <p>{row.subject?.description}</p>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>
            <dt>{label("proposed")}</dt>
            <dd>{row.canonicalService?.name ?? label("novel")}</dd>
          </div>
          <div>
            <dt>{label("status")}</dt>
            <dd>{label(row.status)}</dd>
          </div>
          <div>
            <dt>{label("confidence")}</dt>
            <dd>{Math.round(row.confidence * 100)}%</dd>
          </div>
          <div>
            <dt>{label("model")}</dt>
            <dd>{row.modelVersion}</dd>
          </div>
        </dl>
        <p>{row.evidenceSummary}</p>
        <details>
          <summary>{label("evidence")}</summary>
          <pre className="whitespace-pre-wrap break-words text-xs">
            {JSON.stringify(row.evidence, null, 2)}
          </pre>
        </details>
        <label className="block">
          {label("reason")}
          <Textarea
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <label className="block">
          {label("concept")}
          <select
            className="block border rounded p-2 w-full bg-background"
            value={concept}
            onChange={(event) => setConcept(event.target.value)}
          >
            <option value="">{label("choose")}</option>
            {services
              .filter((service) => service.active)
              .map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <PillButton
            color="green"
            disabled={busy || !reason.trim() || !row.canonicalService?.active}
            onClick={() => review("approve")}
          >
            {label("approve")}
          </PillButton>
          <PillButton
            color="red"
            disabled={busy || !reason.trim()}
            onClick={() => review("reject")}
          >
            {label("reject")}
          </PillButton>
          <PillButton
            color="blue"
            disabled={busy || !reason.trim() || !concept}
            onClick={() => review("remap")}
          >
            {label("remap")}
          </PillButton>
          <PillButton
            color="blue"
            disabled={busy}
            onClick={() =>
              write({
                path: `/service-subjects/${row.subjectType}/${row.subjectId}/reclassify`,
                method: "POST",
              })
            }
          >
            {label("reclassify")}
          </PillButton>
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <label>
            {label("alias")}
            <Input
              value={alias}
              maxLength={200}
              onChange={(event) => setAlias(event.target.value)}
            />
          </label>
          <PillButton
            color="blue"
            disabled={busy || !concept || !alias.trim()}
            onClick={() =>
              write({
                path: `/canonical-services/${concept}/aliases`,
                method: "POST",
                body: { alias: alias.trim(), provenance: "reviewed_ai" },
              })
            }
          >
            {label("addAlias")}
          </PillButton>
        </div>
      </CardContent>
    </Card>
  );
}

const emptyService: AdminCanonicalServiceInput = {
  code: "",
  name: "",
  category: "",
  definition: "",
  inclusionGuidance: null,
  exclusionGuidance: null,
};
export default function AdminServiceMappings() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const label = (key: string) => t(`serviceMappings.${key}`);
  const client = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [serviceOffset, setServiceOffset] = useState(0);
  const [confirmation, setConfirmation] = useState<Write | null>(null);
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<AdminCanonicalServiceInput>(emptyService);
  const isAdmin = user?.role === "admin";
  const queue = useQuery({
    queryKey: ["serviceMarketplace", "queue", offset],
    queryFn: () =>
      api<Page<AdminServiceMappingRow>>(
        `/service-mappings?limit=50&offset=${offset}`,
      ),
    enabled: isAdmin,
  });
  const services = useQuery({
    queryKey: ["serviceMarketplace", "services", serviceOffset],
    queryFn: () =>
      api<Page<AdminCanonicalService>>(
        `/canonical-services?limit=200&offset=${serviceOffset}`,
      ),
    enabled: isAdmin,
  });
  const mutation = useMutation({
    mutationFn: (write: Write) =>
      api<AdminServiceMappingResult>(write.path, write),
    onSuccess: async (result) => {
      setConfirmation(null);
      await client.invalidateQueries(
        { queryKey: ["serviceMarketplace"] },
        { throwOnError: true },
      );
      setNotice(
        result.status === "pending" ? label("pending") : label("saved"),
      );
    },
  });
  const write = (value: Write, confirm = false) => {
    setNotice("");
    mutation.reset();
    if (confirm) setConfirmation(value);
    else mutation.mutate(value);
  };
  if (!isAdmin) return <div className="p-6">{label("adminRequired")}</div>;
  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">{label("title")}</h1>
      <p>{label("description")}</p>
      {(queue.isError || services.isError || mutation.isError) && (
        <p role="alert" className="text-destructive">
          {label("failed")}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <PillButton
        color="blue"
        disabled={mutation.isPending}
        onClick={() =>
          client.invalidateQueries({ queryKey: ["serviceMarketplace"] })
        }
      >
        {label("refresh")}
      </PillButton>
      {queue.isLoading && <p>{label("loading")}</p>}
      {queue.data?.items.length === 0 && <p>{label("empty")}</p>}
      {queue.data?.items.map((row) => (
        <ReviewItem
          key={row.id}
          row={row}
          services={services.data?.items ?? []}
          busy={mutation.isPending || services.isLoading}
          write={write}
        />
      ))}
      <div className="flex gap-2">
        <PillButton
          color="blue"
          disabled={offset === 0 || mutation.isPending}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          {label("previous")}
        </PillButton>
        <PillButton
          color="blue"
          disabled={
            !queue.data || offset + 50 >= queue.data.total || mutation.isPending
          }
          onClick={() => setOffset(offset + 50)}
        >
          {label("next")}
        </PillButton>
      </div>
      <section className="space-y-3">
        <h2 className="text-xl font-semibold">{label("services")}</h2>
        {services.data?.items.map((service) => (
          <Card key={service.id}>
            <CardContent className="p-4 space-y-2">
              <CardHeading as="h3">
                {service.name} · {service.code}
              </CardHeading>
              <p>{service.definition}</p>
              <p>{service.active ? label("active") : label("archived")}</p>
              <p>
                {service.aliases
                  ?.filter((alias) => alias.active)
                  .map((alias) => alias.alias)
                  .join(", ")}
              </p>
              <div className="flex gap-2">
                <PillButton
                  color="blue"
                  disabled={mutation.isPending}
                  onClick={() => {
                    setEditingId(service.id);
                    setForm({
                      code: service.code,
                      name: service.name,
                      category: service.category,
                      definition: service.definition,
                      inclusionGuidance: service.inclusionGuidance,
                      exclusionGuidance: service.exclusionGuidance,
                    });
                  }}
                >
                  {label("edit")}
                </PillButton>
                <PillButton
                  color="red"
                  aria-label={`${label("archive")} ${service.name}`}
                  disabled={!service.active || mutation.isPending}
                  onClick={() =>
                    write(
                      {
                        path: `/canonical-services/${service.id}`,
                        method: "DELETE",
                      },
                      true,
                    )
                  }
                >
                  {label("archive")}
                </PillButton>
              </div>
            </CardContent>
          </Card>
        ))}
        <div className="flex gap-2">
          <PillButton
            color="blue"
            disabled={serviceOffset === 0}
            onClick={() => setServiceOffset(Math.max(0, serviceOffset - 200))}
          >
            {label("previous")}
          </PillButton>
          <PillButton
            color="blue"
            disabled={
              !services.data || serviceOffset + 200 >= services.data.total
            }
            onClick={() => setServiceOffset(serviceOffset + 200)}
          >
            {label("next")}
          </PillButton>
        </div>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            const { code, ...patch } = form;
            write({
              path: `/canonical-services${editingId ? `/${editingId}` : ""}`,
              method: editingId ? "PATCH" : "POST",
              body: editingId ? patch : form,
            });
          }}
        >
          <h3>{editingId ? label("edit") : label("create")}</h3>
          {(
            [
              "code",
              "name",
              "category",
              "definition",
              "inclusionGuidance",
              "exclusionGuidance",
            ] as const
          ).map((field) => (
            <label key={field} className="block">
              {label(field)}
              <Input
                required={
                  !["inclusionGuidance", "exclusionGuidance"].includes(field)
                }
                disabled={field === "code" && editingId !== null}
                maxLength={
                  ["code", "name", "category"].includes(field)
                    ? field === "code"
                      ? 100
                      : 200
                    : 2000
                }
                value={form[field] ?? ""}
                onChange={(event) =>
                  setForm({
                    ...form,
                    [field]:
                      event.target.value ||
                      (["inclusionGuidance", "exclusionGuidance"].includes(
                        field,
                      )
                        ? null
                        : ""),
                  })
                }
              />
            </label>
          ))}
          <PillButton color="blue" type="submit" disabled={mutation.isPending}>
            {label("save")}
          </PillButton>
          {editingId && (
            <PillButton
              color="blue"
              type="button"
              onClick={() => {
                setEditingId(null);
                setForm(emptyService);
              }}
            >
              {label("cancel")}
            </PillButton>
          )}
        </form>
      </section>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{label("confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation?.method === "DELETE"
                ? label("archiveHelp")
                : label("remapHelp")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={mutation.isPending}>
              {label("cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={mutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (confirmation) mutation.mutate(confirmation);
              }}
            >
              {label("confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
