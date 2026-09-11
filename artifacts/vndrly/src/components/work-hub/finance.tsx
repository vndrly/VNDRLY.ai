import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  ownerForUser,
  commandEnvelope,
  createWorkHubOperationId,
  workHubRequest,
} from "@/lib/work-hub-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { downloadCsv } from "./csv";
import { FilePenLine, Receipt, ShieldCheck } from "lucide-react";
import BrandPillButton from "@/components/brand-pill-button";
import { WorkHubCardTitle, WorkHubPageHeading } from "./chrome";
type Row = { id: string; data: Record<string, any> };
type Finance = {
  permissions: Record<string, boolean>;
  providers: { message: string; email: boolean };
  invoices: Row[];
  payroll: Row[];
  grants: Row[];
  members: { userId: number; displayName: string; role: string }[];
  canonicalInvoices: {
    id: number;
    invoiceNumber: string;
    total: string;
    status: string;
  }[];
  fee: { basisPoints: number; capCents: number | null };
};
const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
function useFinance() {
  const { user } = useAuth();
  const owner = ownerForUser(user);
  const cache = useQueryClient();
  const queryKey = [
    "work-hub-finance",
    user?.userId,
    user?.activeMembershipId,
    owner?.type,
    owner?.id,
  ];
  const query = useQuery({
    queryKey,
    enabled: !!owner,
    queryFn: () =>
      workHubRequest<Finance>(
        `/finance?orgType=${owner!.type}&orgId=${owner!.id}`,
      ),
  });
  const retryOperations = useRef(new Map<string, string>());
  const mutation = useMutation({
    mutationFn: async ({
      action,
      payload,
    }: {
      action: string;
      payload: unknown;
    }) => {
      const key = `${user?.userId}:${owner?.type}:${owner?.id}:${action}:${JSON.stringify(payload)}`;
      if (!retryOperations.current.has(key))
        retryOperations.current.set(key, createWorkHubOperationId());
      const result = await workHubRequest(`/finance/${action}`, {
        method: "POST",
        headers: { "x-vndrly-client": "web" },
        body: JSON.stringify(
          commandEnvelope(owner!, payload, retryOperations.current.get(key)),
        ),
      });
      retryOperations.current.delete(key);
      return result;
    },
    onSuccess: () => cache.invalidateQueries({ queryKey }),
  });
  return { owner, query, mutation };
}
function exportInvoice(row: Row) {
  const cell = (v: unknown) =>
    '"' +
    String(v ?? "")
      .replace(/^[\s]*([=+@-])/, "'$1")
      .replace(/"/g, '""') +
    '"';
  const data = [
    "Invoice,Customer,Description,Total USD,Paid USD,Status",
    [
      row.id,
      row.data.customer,
      row.data.description,
      (row.data.amountCents / 100).toFixed(2),
      (row.data.paidCents / 100).toFixed(2),
      row.data.status,
    ]
      .map(cell)
      .join(","),
  ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([data], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `invoice-${row.id}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
function printInvoice(row: Row) {
  const popup = window.open("", "_blank");
  if (!popup) return;
  const title = popup.document.createElement("h1");
  title.textContent = `Invoice ${row.id}`;
  popup.document.body.append(title);
  for (const text of [
    row.data.customer,
    row.data.description,
    `Due: ${row.data.dueDate}`,
    `Total: ${money(row.data.amountCents)}`,
    `Paid: ${money(row.data.paidCents)}`,
    `Balance: ${money(row.data.amountCents - row.data.paidCents)}`,
    `Status: ${row.data.status}`,
  ]) {
    const p = popup.document.createElement("p");
    p.textContent = text;
    popup.document.body.append(p);
  }
  popup.document.title = `Invoice ${row.id}`;
  popup.print();
}
export function WorkHubFinance() {
  const { owner, query, mutation } = useFinance();
  const [editingId, setEditingId] = useState<string | undefined>();
  const [email, setEmail] = useState("");
  const [customer, setCustomer] = useState("");
  const [description, setDescription] = useState("");
  const [total, setTotal] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [payment, setPayment] = useState("");
  const [reference, setReference] = useState("");
  const [method, setMethod] = useState("bank");
  const [employee, setEmployee] = useState("");
  const [gross, setGross] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const send = (action: string, payload: unknown) =>
    mutation.mutate(
      { action, payload },
      {
        onSuccess: (result) => {
          const resource = (result as { resource?: Row })?.resource;
          if (action === "invoice-save" && resource?.id)
            setEditingId(resource.id);
          if (action === "payment" || action === "refund") {
            setPayment("");
            setReference("");
          }
          if (action === "payroll-save") {
            setGross("");
            setEmployee("");
          }
        },
      },
    );
  if (!owner) return <p>Select a company to open Billing & Payroll.</p>;
  if (query.isLoading) return <p>Loading finance permissions…</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  const data = query.data;
  if (!data) return null;
  return (
    <div className="space-y-6">
      <WorkHubPageHeading module="finance" title="Billing & Payroll" />
      <p className="rounded-lg border p-3">
        {data.providers.message} Evaluation platform fee:{" "}
        {data.fee.basisPoints / 100}%
        {data.fee.capCents !== null
          ? `, capped at ${money(data.fee.capCents)}`
          : ""}
        . Outside payments have no platform fee.
      </p>
      {mutation.error && <p role="alert">{mutation.error.message}</p>}
      {data.permissions.billing && (
        <>
          <Card>
            <CardHeader>
              <CardTitle><WorkHubCardTitle icon={Receipt}>Ticket billing</WorkHubCardTitle></CardTitle>
            </CardHeader>
            <CardContent>
              <a className="underline" href="/invoices">
                Prepare and manage approved-ticket invoices
              </a>
              {data.canonicalInvoices.map((row) => (
                <p key={row.id}>
                  <a href={`/invoices/${row.id}`} className="underline">
                    {row.invoiceNumber}
                  </a>{" "}
                  · {row.status} · ${row.total}
                </p>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle><WorkHubCardTitle icon={FilePenLine}>Manual customer invoice</WorkHubCardTitle></CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  send("invoice-save", {
                    ...(editingId ? { id: editingId } : {}),
                    customer,
                    description,
                    amountCents: Math.round(Number(total) * 100),
                    dueDate,
                  });
                }}
              >
                <label>
                  Customer (onboarded or external)
                  <Input
                    value={customer}
                    onChange={(e) => setCustomer(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Services / description
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Total USD
                  <Input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={total}
                    onChange={(e) => setTotal(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Due date
                  <Input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    required
                  />
                </label>
                <BrandPillButton type="submit" tone="brand" className="w-fit justify-self-start" disabled={mutation.isPending}>
                  Save invoice draft
                </BrandPillButton>
                {editingId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingId(undefined);
                      setCustomer("");
                      setDescription("");
                      setTotal("");
                    }}
                  >
                    Start new invoice
                  </Button>
                )}
              </form>
            </CardContent>
          </Card>
          <div className="grid gap-3">
            <label>
              Invoice email recipient
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Payment or outside refund amount USD
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={payment}
                onChange={(e) => setPayment(e.target.value)}
              />
            </label>
            <label>
              Unique payment reference
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <label>
              Outside payment method
              <select
                className="ml-2 border rounded p-2 bg-background"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
              >
                <option value="bank">Bank</option>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
              </select>
            </label>
          </div>
          {data.invoices.length === 0 && <p>No manual invoices yet.</p>}
          {data.invoices.map((row) => (
            <Card key={row.id}>
              <CardHeader>
                <CardTitle><WorkHubCardTitle icon={Receipt}>
                  {row.data.customer} · {money(row.data.amountCents)}
                </WorkHubCardTitle></CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p>{row.data.description}</p>
                {row.data.shareToken && (
                  <p>
                    <a
                      className="underline"
                      target="_blank"
                      rel="noreferrer"
                      href={`/api/work-hub/finance/public/${row.data.shareToken}`}
                    >
                      Public invoice view
                    </a>{" "}
                    · Expires{" "}
                    {new Date(row.data.shareExpiresAt).toLocaleDateString()}{" "}
                    <Button
                      variant="outline"
                      onClick={() => send("revoke-share", { id: row.id })}
                    >
                      Revoke link
                    </Button>
                  </p>
                )}
                <p>
                  {row.data.status} · Balance{" "}
                  {money(row.data.amountCents - row.data.paidCents)}
                </p>
                <div className="flex flex-wrap gap-2">
                  {row.data.status === "draft" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditingId(row.id);
                        setCustomer(row.data.customer);
                        setDescription(row.data.description);
                        setTotal((row.data.amountCents / 100).toFixed(2));
                        setDueDate(row.data.dueDate);
                      }}
                    >
                      Edit draft above
                    </Button>
                  )}
                  {row.data.status === "draft" && (
                    <Button
                      disabled={mutation.isPending}
                      onClick={() => send("issue", { id: row.id })}
                    >
                      Issue invoice
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => printInvoice(row)}>
                    Print / Save PDF
                  </Button>
                  <Button variant="outline" onClick={() => exportInvoice(row)}>
                    Export CSV
                  </Button>
                  {row.data.status !== "draft" && (
                    <>
                      <Button
                        variant="outline"
                        disabled={mutation.isPending}
                        onClick={() => send("share", { id: row.id })}
                      >
                        Create 30-day view link
                      </Button>
                      <Button
                        variant="outline"
                        disabled={
                          mutation.isPending || !email || !data.providers.email
                        }
                        onClick={() => send("email", { id: row.id, to: email })}
                      >
                        Email invoice
                      </Button>
                    </>
                  )}
                  {row.data.status === "issued" && (
                    <Button
                      disabled={mutation.isPending || !payment || !reference}
                      onClick={() =>
                        send("payment", {
                          id: row.id,
                          amountCents: Math.round(Number(payment) * 100),
                          method,
                          reference,
                        })
                      }
                    >
                      Record outside payment
                    </Button>
                  )}
                </div>
                {(row.data.payments ?? []).map((p: any) => (
                  <p key={p.id}>
                    {p.method} · {p.reference} · {money(p.amountCents)} ·
                    Refunded {money(p.refundedCents)}{" "}
                    {data.permissions.refund &&
                      p.refundedCents < p.amountCents && (
                        <Button
                          variant="outline"
                          disabled={mutation.isPending || !payment}
                          onClick={() =>
                            send("refund", {
                              id: row.id,
                              paymentId: p.id,
                              amountCents: Math.round(Number(payment) * 100),
                            })
                          }
                        >
                          Record outside refund
                        </Button>
                      )}
                  </p>
                ))}
              </CardContent>
            </Card>
          ))}
        </>
      )}
      <Card>
        <CardHeader>
          <CardTitle><WorkHubCardTitle icon={FilePenLine}>US W-2 employer payroll</WorkHubCardTitle></CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!data.permissions.payrollView ? (
            <p>
              Payroll data requires an explicit Viewer, Preparer or Approver
              assignment. Company admin access alone does not grant payroll
              access.
            </p>
          ) : (
            <>
              <p>
                Gross-pay drafts only. Taxes and net pay remain uncalculated;
                approval does not submit payroll or transfer money.
              </p>
              <Button variant="outline" disabled={!data.payroll.length} onClick={() => downloadCsv("payroll-gross-drafts.csv", ["Payroll ID", "Period end", "Status", "Employee ID", "Employee", "Gross USD", "Report basis"], data.payroll.flatMap(row => row.data.employees.map((employee: { userId: number; grossCents: number }) => [row.id, row.data.periodEnd, row.data.status, employee.userId, data.members.find(member => member.userId === employee.userId)?.displayName ?? "", (employee.grossCents / 100).toFixed(2), "Gross-pay draft only; no taxes, net pay or funds transfer"])))}>Export gross-pay report CSV</Button>
              {data.permissions.payrollPrepare && (
                <form
                  className="grid gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send("payroll-save", {
                      periodEnd,
                      employees: [
                        {
                          userId: Number(employee),
                          grossCents: Math.round(Number(gross) * 100),
                        },
                      ],
                    });
                  }}
                >
                  <label>
                    Employee
                    <select
                      required
                      className="ml-2 border p-2 bg-background"
                      value={employee}
                      onChange={(e) => setEmployee(e.target.value)}
                    >
                      <option value="">Select employee</option>
                      {data.members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Gross pay USD
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={gross}
                      onChange={(e) => setGross(e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    Period end
                    <Input
                      type="date"
                      value={periodEnd}
                      onChange={(e) => setPeriodEnd(e.target.value)}
                      required
                    />
                  </label>
                  <Button disabled={mutation.isPending}>
                    Save payroll draft
                  </Button>
                </form>
              )}
              {data.payroll.map((row) => (
                <div key={row.id} className="border rounded p-3">
                  <p>
                    Period ending {row.data.periodEnd} · {row.data.status}
                  </p>
                  {row.data.employees.map((e: any) => (
                    <p key={e.userId}>
                      Employee {e.userId}: gross {money(e.grossCents)}
                    </p>
                  ))}
                  {data.permissions.payrollApprove &&
                    row.data.status === "draft" && (
                      <Button
                        disabled={mutation.isPending}
                        onClick={() => send("payroll-approve", { id: row.id })}
                      >
                        Approve gross-pay draft
                      </Button>
                    )}
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
export function WorkHubAdministration() {
  const { owner, query, mutation } = useFinance();
  const [userId, setUserId] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  if (!owner) return <p>Select a company to manage finance access.</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  if (!query.data) return <p>Loading permissions…</p>;
  if (!query.data.permissions.administer)
    return <p>Only company administrators can assign finance roles.</p>;
  return (
    <div className="space-y-5">
    <WorkHubPageHeading module="administration" title="Administration" />
    <Card>
      <CardHeader>
        <CardTitle><WorkHubCardTitle icon={ShieldCheck}>Finance role assignments</WorkHubCardTitle></CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p>
          Assign explicit payroll permissions independently of company
          administration. Saving replaces this person's finance assignments.
        </p>
        {mutation.error && <p role="alert">{mutation.error.message}</p>}
        <label>
          Company member
          <select
            className="ml-2 border rounded p-2 bg-background"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setRoles(
                query.data!.grants.find(
                  (g) => g.data.userId === Number(e.target.value),
                )?.data.roles ?? [],
              );
            }}
          >
            <option value="">Select member</option>
            {query.data.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName} ({m.role})
              </option>
            ))}
          </select>
        </label>
        {[
          "billing_manager",
          "payroll_viewer",
          "payroll_preparer",
          "payroll_approver",
        ].map((role) => (
          <label key={role} className="block">
            <input
              type="checkbox"
              className="mr-2"
              checked={roles.includes(role)}
              onChange={(e) =>
                setRoles(
                  e.target.checked
                    ? [...roles, role]
                    : roles.filter((r) => r !== role),
                )
              }
            />
            {role.replaceAll("_", " ")}
          </label>
        ))}
        <Button
          disabled={!userId || mutation.isPending}
          onClick={() =>
            mutation.mutate({
              action: "grant",
              payload: { userId: Number(userId), roles },
            })
          }
        >
          Save finance roles
        </Button>
        {mutation.isSuccess && <p role="status">Finance assignments saved.</p>}
      </CardContent>
    </Card>
    </div>
  );
}
