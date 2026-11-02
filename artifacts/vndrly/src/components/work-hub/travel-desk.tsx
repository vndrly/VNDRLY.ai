import { useState } from "react";
import {
  Plane,
  ReceiptText,
  Route,
  ClipboardList,
  Download,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRepository, type RepositoryRecord } from "./repository-client";
import {
  RepositoryAudience,
  emptyAudience,
  type Audience,
} from "./repository-audience";
import { WorkHubFiles } from "./files";
import { workHubRequest } from "@/lib/work-hub-client";
const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    cents / 100,
  );
export function TravelDesk() {
  const repo = useRepository(),
    d = repo.data;
  const [selected, setSelected] = useState<string | null>(null),
    [create, setCreate] = useState(false),
    [person, setPerson] = useState(""),
    [audience, setAudience] = useState<Audience>(emptyAudience),
    [draft, setDraft] = useState({
      title: "",
      origin: "",
      destination: "",
      startDate: "",
      endDate: "",
      purpose: "",
      currency: "USD",
      budget: "",
      rate: "",
      perDiem: "",
      siteId: "",
      shiftId: "",
    });
  if (!d) return <p>{repo.error ?? "Loading Travel…"}</p>;
  const trip = d.trips.find((t) => t.id === selected);
  const filtered = d.trips.filter(
    (t) => !person || String(t.data.travelerId) === person,
  );
  const expenseRows = d.expenses.filter((e) =>
    filtered.some((t) => t.id === e.data.tripId),
  );
  const totals = new Map<string, number>();
  for (const e of expenseRows)
    totals.set(
      e.data.currency,
      (totals.get(e.data.currency) ?? 0) + Number(e.data.amountCents),
    );
  return (
    <section className="space-y-3">
      <div className="repository-card">
        <h2 className="flex items-center gap-2">
          <Plane size={17} />
          Travel
        </h2>
        <div className="flex flex-wrap gap-2">
          {d.canAssignTravel && (
            <>
              <button
                className="repo-action"
                onClick={() => setCreate(!create)}
              >
                Authorize travel
              </button>
              <a
                className="repo-action"
                href={`/api/work-hub/repository/travel/export${person ? `?person=${person}` : ""}`}
              >
                <Download size={15} />
                Expense report CSV
              </a>
              <select
                aria-label="Travel expenditures by person"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
                className="rounded border p-2"
              >
                <option value="">All people</option>
                {d.options.people.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}
          {[...totals].map(([currency, total]) => (
            <span key={currency} className="repo-action repo-stat">
              Reported · {money(total, currency)}
            </span>
          ))}
        </div>
      </div>
      {create && d.canAssignTravel && (
        <form
          className="repository-card space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            await repo.save({
              action: "authorize",
              payload: {
                title: draft.title,
                origin: draft.origin,
                destination: draft.destination,
                startDate: draft.startDate,
                endDate: draft.endDate,
                purpose: draft.purpose,
                currency: draft.currency,
                budgetCents: Math.round(Number(draft.budget || 0) * 100),
                mileageRateCents: draft.rate ? Number(draft.rate) * 100 : null,
                perDiemCents: Math.round(Number(draft.perDiem || 0) * 100),
                siteId: draft.siteId ? Number(draft.siteId) : null,
                shiftId: draft.shiftId || null,
                audience,
                templateIds: d.templates.map((t) => t.id),
              },
            });
            setCreate(false);
            setAudience(emptyAudience);
          }}
        >
          <h3>Authorize a trip for each selected traveler</h3>
          <div className="repo-fields">
            {(
              [
                { key: "title", label: "Trip title" },
                { key: "origin", label: "Origin" },
                { key: "destination", label: "Destination / gate" },
                { key: "startDate", label: "Departure", type: "date" },
                { key: "endDate", label: "Return", type: "date" },
                { key: "purpose", label: "Business purpose" },
                { key: "currency", label: "Currency" },
                { key: "budget", label: "Authorized budget", type: "number" },
                { key: "rate", label: "Mileage rate per mile", type: "number" },
                { key: "perDiem", label: "Daily per diem", type: "number" },
                { key: "siteId", label: "Site ID (optional)", type: "number" },
                { key: "shiftId", label: "Shift reference (optional)" },
              ] as const
            ).map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  type={"type" in f ? f.type : "text"}
                  step="any"
                  min={"type" in f && f.type === "number" ? "0" : undefined}
                  required={[
                    "title",
                    "origin",
                    "destination",
                    "startDate",
                    "endDate",
                    "purpose",
                    "currency",
                  ].includes(f.key)}
                  value={draft[f.key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [f.key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <RepositoryAudience
            value={audience}
            onChange={setAudience}
            options={d.options}
          />
          <button className="repo-action" disabled={repo.pending}>
            Authorize selected travelers
          </button>
        </form>
      )}
      {!trip && (
        <div className="grid gap-3">
          {filtered.map((t) => {
            const expenses = d.expenses.filter((e) => e.data.tripId === t.id);
            return (
              <section key={t.id} className="repository-card">
                <h3>
                  {t.data.title} · {t.data.travelerName}
                </h3>
                <p>
                  {t.data.origin} → {t.data.destination}
                </p>
                <p>
                  {t.data.startDate} – {t.data.endDate} · {t.data.status}
                </p>
                <p>
                  {money(
                    expenses.reduce(
                      (n, e) => n + Number(e.data.amountCents),
                      0,
                    ),
                    t.data.currency,
                  )}{" "}
                  reported · {money(t.data.budgetCents, t.data.currency)}{" "}
                  authorized
                </p>
                <button
                  className="repo-action"
                  onClick={() => setSelected(t.id)}
                >
                  Open trip
                </button>
              </section>
            );
          })}
          {!filtered.length && <p>No authorized trips.</p>}
        </div>
      )}
      {trip && (
        <TravelTrip
          key={`${repo.owner?.id}:${trip.id}`}
          trip={trip}
          onBack={() => setSelected(null)}
        />
      )}
      <details className="repository-card">
        <summary className="font-semibold">Travel working templates</summary>
        {d.templates.map((t) => (
          <TravelTemplate
            key={t.id}
            template={t}
            editable={d.canAssignTravel}
          />
        ))}
      </details>
      {repo.error && <p role="alert">{repo.error}</p>}
    </section>
  );
}
function TravelTemplate({
  template,
  editable,
}: {
  template: RepositoryRecord;
  editable: boolean;
}) {
  const repo = useRepository(),
    [name, setName] = useState(String(template.data.name)),
    [fields, setFields] = useState(
      (template.data.fields as string[]).join("\n"),
    );
  return (
    <details className="py-2">
      <summary>{template.data.name}</summary>
      {editable ? (
        <div className="repo-fields">
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Fields, one per line
            <textarea
              rows={5}
              value={fields}
              onChange={(e) => setFields(e.target.value)}
            />
          </label>
          <button
            className="repo-action"
            disabled={repo.pending}
            onClick={() =>
              void repo.save({
                action: "template",
                version: template.data.version,
                payload: {
                  id: template.id,
                  name,
                  fields: fields
                    .split("\n")
                    .map((f) => f.trim())
                    .filter(Boolean),
                },
              })
            }
          >
            Save template
          </button>
        </div>
      ) : (
        <p>{template.data.fields.join(" · ")}</p>
      )}
    </details>
  );
}
function TravelTrip({
  trip,
  onBack,
}: {
  trip: RepositoryRecord;
  onBack: () => void;
}) {
  const repo = useRepository(),
    d = repo.data!,
    [kind, setKind] = useState("receipt"),
    [reason, setReason] = useState(""),
    [entry, setEntry] = useState({
      date: trip.data.startDate as string,
      description: "",
      merchant: "",
      amount: "",
      distance: "",
      odometerStart: "",
      odometerEnd: "",
      documentId: "",
      receiptId: "",
      missingReceiptReason: "",
    }),
    [mileageMethod, setMileageMethod] = useState("distance");
  const receipts = useQuery({
    queryKey: ["repository-receipts", repo.user?.userId, repo.owner?.id],
    queryFn: () =>
      workHubRequest<{ id: string; fields: Record<string, string> }[]>(
        "/repository/receipts",
      ),
  });
  const [reading, setReading] = useState(false),
    [readError, setReadError] = useState("");
  const documents = useQuery({
    queryKey: ["travel-documents", repo.user?.userId, repo.owner?.id, trip.id],
    queryFn: () =>
      workHubRequest<{ id: string; data: { name: string; tripId?: string } }[]>(
        `/file-library?orgType=${repo.owner!.type}&orgId=${repo.owner!.id}`,
      ),
  });
  const expenses = d.expenses.filter((e) => e.data.tripId === trip.id),
    editable = ["authorized", "returned"].includes(trip.data.status);
  const action = async (action: string) =>
    repo.save({
      action: "trip-status",
      version: trip.data.version,
      payload: { tripId: trip.id, action, reason },
    });
  return (
    <div className="space-y-3">
      <section className="repository-card">
        <button className="repo-action" onClick={onBack}>
          Back to Travel
        </button>
        <h2 className="mt-3 flex gap-2">
          <Plane size={17} />
          {trip.data.title} · {trip.data.travelerName}
        </h2>
        <p>
          {trip.data.origin} → {trip.data.destination} · {trip.data.status}
        </p>
        <p>
          {trip.data.startDate} – {trip.data.endDate}
        </p>
        <p>{trip.data.purpose}</p>
        <p>
          Authorized budget: {money(trip.data.budgetCents, trip.data.currency)}{" "}
          · Reported:{" "}
          {money(
            expenses.reduce((n, e) => n + Number(e.data.amountCents), 0),
            trip.data.currency,
          )}
        </p>
        <p>
          Mileage rate:{" "}
          {trip.data.mileageRateCents == null
            ? "Not authorized"
            : money(trip.data.mileageRateCents, trip.data.currency)}{" "}
          / mile · Per diem: {money(trip.data.perDiemCents, trip.data.currency)}{" "}
          / day
        </p>
        <div className="flex flex-wrap gap-2">
          {editable && (
            <button
              className="repo-action"
              disabled={repo.pending}
              onClick={() => void action("submit")}
            >
              Submit for office review
            </button>
          )}
          {d.canAssignTravel && trip.data.status === "submitted" && (
            <>
              <input
                aria-label="Review notes"
                className="rounded border p-2"
                placeholder="Review / return notes"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                className="repo-action"
                disabled={repo.pending}
                onClick={() => void action("approve")}
              >
                Approve report
              </button>
              <button
                className="repo-action"
                disabled={repo.pending || !reason.trim()}
                onClick={() => void action("return")}
              >
                Return for correction
              </button>
            </>
          )}
          {d.canAssignTravel && trip.data.status === "approved" && (
            <button
              className="repo-action"
              disabled={repo.pending}
              onClick={() => void action("close")}
            >
              Close trip
            </button>
          )}
          <button className="repo-action" onClick={() => window.print()}>
            Print trip report
          </button>
        </div>
        <details>
          <summary>Authorization and review history</summary>
          {trip.data.history?.map((h: any, i: number) => (
            <p key={i}>
              {h.at} · {h.action} ·{" "}
              {d.creators.find((c) => c.id === h.actorId)?.name ?? h.actorId}{" "}
              {h.reason}
            </p>
          ))}
        </details>
      </section>
      <TripForms trip={trip} editable={editable} />
      {editable && (
        <section className="repository-card">
          <h3 className="flex gap-2">
            <ReceiptText size={16} />
            Trip receipts and documents
          </h3>
          <WorkHubFiles defaultScope="company" tripId={trip.id} />
        </section>
      )}
      {editable && (
        <form
          className="repository-card space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await repo.save({
              action: "expense",
              payload: {
                tripId: trip.id,
                kind,
                date: entry.date,
                description: entry.description,
                merchant: entry.merchant,
                ...(kind === "mileage"
                  ? mileageMethod === "distance"
                    ? { distance: Number(entry.distance) }
                    : {
                        odometerStart: Number(entry.odometerStart),
                        odometerEnd: Number(entry.odometerEnd),
                      }
                  : { amountCents: Math.round(Number(entry.amount) * 100) }),
                documentId: entry.documentId || null,
                receiptId: entry.receiptId || null,
                missingReceiptReason: entry.missingReceiptReason,
                reimbursable: true,
              },
            });
            setEntry({
              ...entry,
              description: "",
              amount: "",
              merchant: "",
              documentId: "",
              receiptId: "",
            });
          }}
        >
          <h3 className="flex gap-2">
            <Route size={16} />
            Add mileage / expense
          </h3>
          <div className="repo-fields">
            <label>
              Type
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {[
                  "receipt",
                  "mileage",
                  "per_diem",
                  "lodging",
                  "transportation",
                  "advance",
                  "other",
                ].map((k) => (
                  <option key={k} value={k}>
                    {k.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input
                required
                type="date"
                value={entry.date}
                min={trip.data.startDate}
                max={trip.data.endDate}
                onChange={(e) => setEntry({ ...entry, date: e.target.value })}
              />
            </label>
            <label>
              Description
              <input
                required
                value={entry.description}
                onChange={(e) =>
                  setEntry({ ...entry, description: e.target.value })
                }
              />
            </label>
            <label>
              Merchant
              <input
                value={entry.merchant}
                onChange={(e) =>
                  setEntry({ ...entry, merchant: e.target.value })
                }
              />
            </label>
            {kind === "mileage" ? (
              <>
                <label>
                  Mileage entry
                  <select
                    value={mileageMethod}
                    onChange={(e) => setMileageMethod(e.target.value)}
                  >
                    <option value="distance">Business miles</option>
                    <option value="odometer">Odometer readings</option>
                  </select>
                </label>
                {(mileageMethod === "distance"
                  ? ["distance"]
                  : ["odometerStart", "odometerEnd"]
                ).map((key) => (
                  <label key={key}>
                    {key === "distance"
                      ? "Business miles"
                      : key === "odometerStart"
                        ? "Starting odometer"
                        : "Ending odometer"}
                    <input
                      type="number"
                      min="0"
                      step="any"
                      required
                      value={entry[key as keyof typeof entry]}
                      onChange={(e) =>
                        setEntry({ ...entry, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </>
            ) : (
              <label>
                Amount ({trip.data.currency})
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={entry.amount}
                  onChange={(e) =>
                    setEntry({ ...entry, amount: e.target.value })
                  }
                />
              </label>
            )}
            <label>
              Receipt/document
              <select
                value={entry.documentId}
                onChange={(e) =>
                  setEntry({ ...entry, documentId: e.target.value })
                }
              >
                <option value="">Choose uploaded trip receipt</option>
                {documents.data
                  ?.filter((doc) => doc.data.tripId === trip.id)
                  .map((doc) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.data.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Existing Conversations receipt
              <select
                value={entry.receiptId}
                onChange={(e) => {
                  const r = receipts.data?.find((r) => r.id === e.target.value);
                  setEntry({
                    ...entry,
                    receiptId: e.target.value,
                    ...(r
                      ? {
                          merchant: r.fields.merchant,
                          date: r.fields.date,
                          amount: r.fields.total,
                          description: r.fields.note || r.fields.merchant,
                        }
                      : {}),
                  });
                }}
              >
                <option value="">Choose a receipt you can access</option>
                {receipts.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fields.date} · {r.fields.merchant} · {r.fields.total}{" "}
                    {r.fields.currency}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="repo-action"
              disabled={!entry.documentId || reading}
              onClick={async () => {
                setReading(true);
                setReadError("");
                try {
                  const r = await workHubRequest<{
                    fields: Record<string, string>;
                  }>("/repository/receipt-read", {
                    method: "POST",
                    body: JSON.stringify({ documentId: entry.documentId }),
                  });
                  setEntry({
                    ...entry,
                    merchant: r.fields.merchant || entry.merchant,
                    date: r.fields.date || entry.date,
                    amount: r.fields.total || entry.amount,
                  });
                } catch (e) {
                  setReadError(
                    e instanceof Error ? e.message : "Enter fields manually",
                  );
                } finally {
                  setReading(false);
                }
              }}
            >
              {reading ? "Reading receipt…" : "Read receipt photo"}
            </button>
            <p>Review all receipt fields before saving.</p>
            {readError && <p role="alert">{readError}</p>}
            <label>
              Missing receipt explanation
              <textarea
                value={entry.missingReceiptReason}
                onChange={(e) =>
                  setEntry({ ...entry, missingReceiptReason: e.target.value })
                }
              />
            </label>
          </div>
          <button
            className="repo-action"
            disabled={
              repo.pending ||
              (kind === "mileage" && trip.data.mileageRateCents == null)
            }
          >
            Save expense
          </button>
        </form>
      )}
      <section className="repository-card">
        <h3>Trip expenditure register</h3>
        {expenses.map((e) => (
          <div key={e.id} className="border-b py-2">
            <p className="font-semibold">
              {e.data.date} · {e.data.description} ·{" "}
              {money(e.data.amountCents, e.data.currency)}
            </p>
            <p>
              {e.data.kind} · {e.data.merchant}{" "}
              {e.data.kind === "mileage"
                ? ` · ${e.data.distance ?? Number(e.data.odometerEnd) - Number(e.data.odometerStart)} miles`
                : ""}
            </p>
            {e.data.documentId && (
              <a
                className="repo-action"
                href={`/api/work-hub/repository/expenses/${e.id}/receipt`}
              >
                Receipt
              </a>
            )}
            {e.data.missingReceiptReason && (
              <p>Missing receipt: {e.data.missingReceiptReason}</p>
            )}
          </div>
        ))}
        {!expenses.length && <p>No expenses reported.</p>}
      </section>
      {repo.error && <p role="alert">{repo.error}</p>}
    </div>
  );
}

function TripForms({
  trip,
  editable,
}: {
  trip: RepositoryRecord;
  editable: boolean;
}) {
  return (
    <section className="repository-card space-y-2">
      <h3 className="flex gap-2">
        <ClipboardList size={16} />
        Assigned travel tools and forms
      </h3>
      {(trip.data.formSnapshots ?? []).map((form: any) => (
        <TripForm key={form.id} trip={trip} form={form} editable={editable} />
      ))}
    </section>
  );
}
function TripForm({
  trip,
  form,
  editable,
}: {
  trip: RepositoryRecord;
  form: any;
  editable: boolean;
}) {
  const repo = useRepository(),
    [values, setValues] = useState<Record<string, string>>(
      trip.data.forms?.[form.id]?.values ?? {},
    );
  return (
    <details>
      <summary className="font-semibold py-2">{form.name}</summary>
      <form
        className="repo-fields"
        onSubmit={async (e) => {
          e.preventDefault();
          await repo.save({
            action: "trip-form",
            version: trip.data.version,
            payload: { tripId: trip.id, formId: form.id, values },
          });
        }}
      >
        {form.fields.map((field: string) => (
          <label key={field}>
            {field}
            <input
              disabled={!editable}
              value={values[field] ?? ""}
              onChange={(e) =>
                setValues({ ...values, [field]: e.target.value })
              }
            />
          </label>
        ))}
        {editable && (
          <button className="repo-action" disabled={repo.pending}>
            Save traveler copy
          </button>
        )}
      </form>
    </details>
  );
}
