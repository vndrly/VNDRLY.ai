import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import BrandPillButton from "@/components/brand-pill-button";
import { translateApiError } from "@/lib/api-error";

type Worker = {
  id: string | number;
  userId: number;
  name: string;
  email: string;
  role: "gatekeeper" | "gate_supervisor" | null;
  status: string;
  siteIds: number[];
  invitationId?: string | number | null;
  invitationState?: string | null;
};
type Company = {
  id: string | number;
  name: string;
  status: string;
  workers: Worker[];
};
type Data = { items: Company[]; sites: { id: number; name: string }[] };
type Editor = {
  companyId: string | number;
  workerId?: string | number;
  name: string;
  email: string;
  role: NonNullable<Worker["role"]>;
  siteIds: number[];
};
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function request<T>(
  url: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${BASE}${url}`, {
    method,
    credentials: "include",
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error("Request failed"), {
      status: response.status,
      data,
    });
  return data as T;
}

export default function VendorManagedSubcontractorsCard({
  vendorId,
  vendorName,
}: {
  vendorId: number;
  vendorName: string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const base = `/api/vendors/${vendorId}/managed-subcontractors`;
  const queryKey = ["vendor-managed-subcontractors", vendorId];
  const query = useQuery({ queryKey, queryFn: () => request<Data>(base) });
  const [companyName, setCompanyName] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [revoke, setRevoke] = useState<{
    companyId: string | number;
    worker: Worker;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activationUrl, setActivationUrl] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({
      path,
      method,
      body,
    }: {
      path: string;
      method: string;
      body: unknown;
    }) =>
      request<{ invitation?: { state: string }; activationUrl?: string }>(
        path,
        method,
        body,
      ),
    onSuccess: async (result) => {
      setCompanyName("");
      setEditor(null);
      setRevoke(null);
      setActivationUrl(result.activationUrl ?? null);
      setNotice(
        result.invitation
          ? t(
              result.invitation.state === "delivery_failed"
                ? "managedSubcontractors.deliveryFailed"
                : "managedSubcontractors.invitationCreated",
            )
          : null,
      );
      await queryClient.invalidateQueries({ queryKey });
    },
  });
  const resetAction = () => {
    mutation.reset();
    setNotice(null);
    setActivationUrl(null);
  };
  const key = (value: string) => t(`managedSubcontractors.${value}`);
  const invitationLabel = (state: string) =>
    key(
      [
        "pending",
        "delivered",
        "delivery_failed",
        "claimed",
        "expired",
        "revoked",
      ].includes(state)
        ? `invitation_${state}`
        : "invitation_pending",
    );
  return (
    <Card data-testid="vendor-managed-subcontractors-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className={CARD_TITLE_ICON_CLASS} />
          {key("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">{key("description")}</p>
        {query.isLoading && <p role="status">{key("loading")}</p>}
        {query.isError && (
          <div role="alert">
            {key("loadFailed")}{" "}
            <BrandPillButton onClick={() => void query.refetch()}>
              {key("retry")}
            </BrandPillButton>
          </div>
        )}
        {mutation.isError && (
          <p role="alert" className="text-destructive">
            {translateApiError(mutation.error, t)}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {activationUrl && (
          <div className="space-y-2 rounded-md border p-3">
            <Label htmlFor={`activation-link-${vendorId}`}>
              {key("activationLink")}
            </Label>
            <Input
              id={`activation-link-${vendorId}`}
              value={activationUrl}
              readOnly
              onFocus={(event) => event.target.select()}
            />
            <p className="text-sm text-muted-foreground">
              {key("activationLinkHelp")}
            </p>
          </div>
        )}
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            resetAction();
            mutation.mutate({
              path: base,
              method: "POST",
              body: { name: companyName.trim() },
            });
          }}
        >
          <div className="flex-1 min-w-48 space-y-2">
            <Label htmlFor={`subcontractor-name-${vendorId}`}>
              {key("companyName")}
            </Label>
            <Input
              id={`subcontractor-name-${vendorId}`}
              required
              maxLength={200}
              value={companyName}
              onChange={(event) => setCompanyName(event.target.value)}
            />
          </div>
          <BrandPillButton
            type="submit"
            tone="blue"
            disabled={mutation.isPending || !companyName.trim()}
          >
            {key("createCompany")}
          </BrandPillButton>
        </form>
        {query.data?.items.length === 0 && (
          <p className="text-sm text-muted-foreground">{key("empty")}</p>
        )}
        {query.data?.items.map((company) => (
          <section
            key={company.id}
            data-testid={`managed-subcontractor-${company.id}`}
            className="rounded-lg border p-4 space-y-3"
          >
            <div className="flex flex-wrap justify-between items-center gap-3">
              <h3 className="font-semibold">{company.name}</h3>
              <BrandPillButton
                tone="blue"
                disabled={mutation.isPending || company.status !== "managed"}
                onClick={() => {
                  resetAction();
                  setRevoke(null);
                  setEditor({
                    companyId: company.id,
                    name: "",
                    email: "",
                    role: "gatekeeper",
                    siteIds: [],
                  });
                }}
              >
                {key("addWorker")}
              </BrandPillButton>
            </div>
            <p className="text-sm text-muted-foreground">
              {t("managedSubcontractors.employer", {
                employer: company.name,
                vendor: vendorName,
              })}
            </p>
            {company.workers.length === 0 && (
              <p className="text-sm">{key("noWorkers")}</p>
            )}
            {company.workers.map((worker) => (
              <div
                key={worker.id}
                className="border-t pt-3 flex flex-wrap justify-between gap-3"
              >
                <div>
                  <p className="font-medium">{worker.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {worker.email}
                  </p>
                  <p className="text-sm">
                    {key(worker.role ?? "noRole")} ·{" "}
                    {key(
                      worker.status === "active"
                        ? "active"
                        : worker.status === "paused"
                          ? "paused"
                          : "terminated",
                    )}
                  </p>
                  <p className="text-sm">
                    {worker.siteIds
                      .map(
                        (id) =>
                          query.data?.sites.find((site) => site.id === id)
                            ?.name ?? key("unavailableSite"),
                      )
                      .join(", ")}
                  </p>
                  {worker.invitationState && (
                    <p className="text-sm">
                      {t("managedSubcontractors.invitationStatus", {
                        state: invitationLabel(worker.invitationState),
                      })}
                    </p>
                  )}
                </div>
                {worker.status !== "terminated" && (
                  <div className="flex flex-wrap gap-2">
                    <BrandPillButton
                      tone="blue"
                      disabled={mutation.isPending}
                      onClick={() => {
                        resetAction();
                        setRevoke(null);
                        setEditor({
                          companyId: company.id,
                          workerId: worker.id,
                          name: worker.name,
                          email: worker.email,
                          role: worker.role ?? "gatekeeper",
                          siteIds: [...worker.siteIds],
                        });
                      }}
                    >
                      {key("editAccess")}
                    </BrandPillButton>
                    <BrandPillButton
                      tone="red"
                      disabled={mutation.isPending}
                      onClick={() => {
                        resetAction();
                        setEditor(null);
                        setRevoke({ companyId: company.id, worker });
                      }}
                    >
                      {key("revokeAccess")}
                    </BrandPillButton>
                  </div>
                )}
                {worker.status !== "terminated" &&
                  worker.invitationId &&
                  worker.invitationState !== "claimed" && (
                    <BrandPillButton
                      disabled={mutation.isPending}
                      tone="blue"
                      onClick={() => {
                        resetAction();
                        mutation.mutate({
                          path: `${base}/${company.id}/workers/${worker.id}/resend-invitation`,
                          method: "POST",
                          body: {},
                        });
                      }}
                    >
                      {key("resendInvitation")}
                    </BrandPillButton>
                  )}
              </div>
            ))}
            {editor?.companyId === company.id && (
              <form
                className="border-t pt-4 space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  mutation.mutate({
                    path: `${base}/${company.id}/workers${editor.workerId ? `/${editor.workerId}` : ""}`,
                    method: editor.workerId ? "PATCH" : "POST",
                    body: editor.workerId
                      ? { role: editor.role, siteIds: editor.siteIds }
                      : {
                          name: editor.name.trim(),
                          email: editor.email.trim(),
                          role: editor.role,
                          siteIds: editor.siteIds,
                        },
                  });
                }}
              >
                <h4 className="font-semibold">
                  {key(editor.workerId ? "editAccess" : "addWorker")}
                </h4>
                {!editor.workerId && (
                  <>
                    <Label htmlFor={`worker-name-${company.id}`}>
                      {key("workerName")}
                    </Label>
                    <Input
                      id={`worker-name-${company.id}`}
                      required
                      maxLength={200}
                      value={editor.name}
                      onChange={(e) =>
                        setEditor({ ...editor, name: e.target.value })
                      }
                    />
                    <Label htmlFor={`worker-email-${company.id}`}>
                      {key("email")}
                    </Label>
                    <Input
                      id={`worker-email-${company.id}`}
                      type="email"
                      required
                      value={editor.email}
                      onChange={(e) =>
                        setEditor({ ...editor, email: e.target.value })
                      }
                    />
                    <p className="text-sm text-muted-foreground">
                      {key("invitationHelp")}
                    </p>
                  </>
                )}
                <Label htmlFor={`worker-role-${company.id}`}>
                  {key("role")}
                </Label>
                <select
                  id={`worker-role-${company.id}`}
                  className="w-full border rounded-md bg-background p-2"
                  value={editor.role}
                  onChange={(e) =>
                    setEditor({
                      ...editor,
                      role: e.target.value as NonNullable<Worker["role"]>,
                    })
                  }
                >
                  <option value="gatekeeper">{key("gatekeeper")}</option>
                  <option value="gate_supervisor">
                    {key("gate_supervisor")}
                  </option>
                </select>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">
                    {key("sites")}
                  </legend>
                  {query.data?.sites.map((site) => (
                    <label
                      key={site.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={editor.siteIds.includes(site.id)}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            siteIds: event.target.checked
                              ? [...editor.siteIds, site.id]
                              : editor.siteIds.filter((id) => id !== site.id),
                          })
                        }
                      />
                      {site.name}
                    </label>
                  ))}
                  {!query.data?.sites.length && (
                    <p className="text-sm">{key("noSites")}</p>
                  )}
                </fieldset>
                <div className="flex gap-2">
                  <BrandPillButton
                    type="submit"
                    tone="blue"
                    disabled={mutation.isPending || !editor.siteIds.length}
                  >
                    {key("saveWorker")}
                  </BrandPillButton>
                  <BrandPillButton
                    disabled={mutation.isPending}
                    onClick={() => setEditor(null)}
                  >
                    {key("cancel")}
                  </BrandPillButton>
                </div>
              </form>
            )}
            {revoke?.companyId === company.id && (
              <div
                role="alertdialog"
                aria-label={key("revokeAccess")}
                className="border rounded-md p-3 space-y-3"
              >
                <p>
                  {t("managedSubcontractors.revokeWarning", {
                    name: revoke.worker.name,
                  })}
                </p>
                <div className="flex gap-2">
                  <BrandPillButton
                    tone="red"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        path: `${base}/${company.id}/workers/${revoke.worker.id}`,
                        method: "PATCH",
                        body: { status: "terminated" },
                      })
                    }
                  >
                    {key("confirmRevoke")}
                  </BrandPillButton>
                  <BrandPillButton
                    disabled={mutation.isPending}
                    onClick={() => setRevoke(null)}
                  >
                    {key("cancel")}
                  </BrandPillButton>
                </div>
              </div>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
