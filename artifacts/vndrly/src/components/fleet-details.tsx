import { CardHeading } from "@/components/ui/card-heading";
import { useFleetResourceCopy } from "@/lib/fleet-resource-copy";
import { useRef, useState } from "react";
import {
  FleetDetailSchema,
  FleetRigPackageSchema,
  type FleetDetail,
  type FleetResources,
  type FleetRigPackage,
} from "@workspace/api-zod";
import { PngPillButton } from "./png-pill-rollover";
import { BrandedCheckbox } from "./branded-checkbox";
export type FleetDetailSave = {
  operationId: string;
  expectedVersion: number;
  detail: FleetDetail;
};
export type FleetResourceIndicator = {
  status: "green" | "red";
  label: string;
};
export type FleetDetailBuilderProps = {
  companyId: number;
  accessGroupIds: string[];
  resources: FleetResources;
  rigPackages: FleetRigPackage[];
  assessments?: Record<string, FleetResourceIndicator>;
  initialDetail?: FleetDetail;
  onSave: (input: FleetDetailSave) => Promise<unknown>;
};
/** Assembly records reusable defaults only. Inventory custody and run reservations
 * remain separate canonical operations; document warnings never hide a choice. */
export function FleetDetailBuilder({
  companyId,
  accessGroupIds,
  resources,
  rigPackages,
  assessments = {},
  initialDetail,
  onSave,
}: FleetDetailBuilderProps) {
  const copy = useFleetResourceCopy();
  const [name, setName] = useState(initialDetail?.name ?? ""),
    [truck, setTruck] = useState(initialDetail?.vehicleAssetId ?? ""),
    [rig, setRig] = useState(initialDetail?.rigPackageId ?? ""),
    [driver, setDriver] = useState(String(initialDetail?.driverUserId ?? "")),
    [search, setSearch] = useState("");
  const [attempt, setAttempt] = useState<FleetDetailSave | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  const matches = (id: string, label: string) =>
    id === truck ||
    id === rig ||
    id === driver ||
    label.toLowerCase().includes(search.toLowerCase());
  const trucks = resources.equipment.filter(
    (item) =>
      ["truck", "vehicle"].includes(item.category) &&
      !["retired", "merged"].includes(item.status),
  );
  const packages = rigPackages.filter((item) => !item.archivedAt);
  const selectedRig = packages.find((item) => item.id === rig);
  const members = [
    {
      id: `vehicle:${truck}`,
      label: trucks.find((item) => item.id === truck)?.name,
    },
    ...(selectedRig?.components.map((item) => ({
      id: `component:${item.assetId}`,
      label:
        resources.equipment.find((asset) => asset.id === item.assetId)?.name ??
        item.role,
    })) ?? []),
    {
      id: `driver:${driver}`,
      label: resources.drivers.find((item) => String(item.userId) === driver)
        ?.name,
    },
  ].filter((item) => item.label);
  function review() {
    setMessage("");
    try {
      if (
        !trucks.some((item) => item.id === truck) ||
        !resources.drivers.some((item) => item.userId === Number(driver)) ||
        (rig && !selectedRig) ||
        !accessGroupIds.length
      )
        throw new Error("Choose an authorized truck, optional rig and driver.");
      const detail = FleetDetailSchema.parse({
        ...initialDetail,
        id: initialDetail?.id ?? crypto.randomUUID(),
        companyId,
        version: (initialDetail?.version ?? 0) + 1,
        name,
        vehicleAssetId: truck,
        rigPackageId: selectedRig?.id ?? null,
        rigPackageVersion: selectedRig?.version ?? null,
        driverUserId: Number(driver),
        accessGroupIds,
        effectiveFrom: initialDetail?.effectiveFrom ?? new Date().toISOString(),
        effectiveUntil: initialDetail?.effectiveUntil ?? null,
        archivedAt: null,
      });
      setAttempt({
        operationId: crypto.randomUUID(),
        expectedVersion: initialDetail?.version ?? 0,
        detail,
      });
    } catch {
      setMessage(
        "Enter a name and choose an authorized truck, optional rig and driver.",
      );
    }
  }
  async function save() {
    if (!attempt || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await onSave(attempt);
      setAttempt(null);
      setMessage("Detail saved. Inventory custody is unchanged.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save Detail. Retry the same request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="fleet-detail-group space-y-4"
      aria-label={copy("Detail builder")}
    >
      <CardHeading as="h2">{initialDetail ? copy("Edit Detail") : copy("Build a Detail")}</CardHeading>
      <p>
        {copy(
          " Choose a truck, its optional towed package, and a driver. A Detail can be reused across runs. ",
        )}
      </p>
      <fieldset disabled={busy || Boolean(attempt)} className="space-y-4">
        <label className="block">
          {copy(" Detail name ")}
          <input
            aria-label={copy("Detail name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block">
          {copy(" Search resources ")}
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="fleet-asset-fields">
          <label>
            {copy(" Available Trucks ")}
            <select
              aria-label={copy("Available Trucks")}
              value={truck}
              onChange={(e) => setTruck(e.target.value)}
            >
              <option value="">
                {copy("Choose truck or support vehicle")}
              </option>
              {trucks
                .filter((item) => matches(item.id, item.name))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.status.replaceAll("_", " ")}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {copy(" Available Rig ")}
            <select
              aria-label={copy("Available Rig")}
              value={rig}
              onChange={(e) => setRig(e.target.value)}
            >
              <option value="">{copy("No towed package")}</option>
              {packages
                .filter((item) => matches(item.id, item.name))
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.components.length}
                    {copy(" components ")}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {copy(" Driver ")}
            <select
              aria-label={copy("Driver")}
              value={driver}
              onChange={(e) => setDriver(e.target.value)}
            >
              <option value="">{copy("Choose driver")}</option>
              {resources.drivers
                .filter((item) => matches(String(item.userId), item.name))
                .map((item) => (
                  <option key={item.userId} value={item.userId}>
                    {item.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      </fieldset>
      <ul>
        {members.map((item) => (
          <li key={item.id}>
            <span
              style={{
                color:
                  assessments[item.id]?.status === "green"
                    ? "#15803D"
                    : "#DC2626",
              }}
              aria-hidden="true"
            >
              ●{" "}
            </span>
            {item.label} ·{" "}
            {assessments[item.id]?.label ?? copy("Compliance unverified")}
          </li>
        ))}
      </ul>
      <p>
        {copy(
          " Document compliance warnings remain visible and selectable. Run availability, custody and operational holds are checked when assigning work. ",
        )}
      </p>
      {message && (
        <p role={message.startsWith("Detail saved") ? "status" : "alert"}>
          {copy(message)}
        </p>
      )}
      {attempt ? (
        <>
          <p>
            {copy(" Review: ")}
            {attempt.detail.name}
            {copy(". No equipment is checked out or returned. ")}
          </p>
          <PngPillButton disabled={busy} onClick={() => void save()}>
            {copy(" Save Detail ")}
          </PngPillButton>
          <PngPillButton
            disabled={busy}
            onClick={() => {
              setAttempt(null);
              setMessage("");
            }}
          >
            {copy(" Edit selection ")}
          </PngPillButton>
        </>
      ) : (
        <PngPillButton onClick={review}>{copy("Review Detail")}</PngPillButton>
      )}
    </section>
  );
}
export function FleetRigPackageBuilder({
  companyId,
  equipment,
  initialPackage,
  onSave,
}: {
  companyId: number;
  equipment: FleetResources["equipment"];
  initialPackage?: FleetRigPackage;
  onSave: (input: {
    operationId: string;
    expectedVersion: number;
    package: FleetRigPackage;
  }) => Promise<unknown>;
}) {
  const copy = useFleetResourceCopy();
  const [name, setName] = useState(initialPackage?.name ?? ""),
    [components, setComponents] = useState<FleetRigPackage["components"]>(
      initialPackage?.components ?? [],
    ),
    [attempt, setAttempt] = useState<{
      operationId: string;
      expectedVersion: number;
      package: FleetRigPackage;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  const roles = ["trailer", "dolly", "tank", "pump", "accessory"] as const;
  function review() {
    try {
      setAttempt({
        operationId: crypto.randomUUID(),
        expectedVersion: initialPackage?.version ?? 0,
        package: FleetRigPackageSchema.parse({
          ...initialPackage,
          id: initialPackage?.id ?? crypto.randomUUID(),
          companyId,
          version: (initialPackage?.version ?? 0) + 1,
          name,
          components: components.map((item, sequence) => ({
            ...item,
            sequence,
          })),
          effectiveFrom:
            initialPackage?.effectiveFrom ?? new Date().toISOString(),
          effectiveUntil: initialPackage?.effectiveUntil ?? null,
          archivedAt: null,
        }),
      });
      setMessage("");
    } catch {
      setMessage("Enter a package name and choose at least one component.");
    }
  }
  async function save() {
    if (!attempt || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage("");
    try {
      await onSave(attempt);
      setAttempt(null);
      setMessage("Rig package saved.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save. Retry the same request.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="fleet-detail-group space-y-3">
      <CardHeading as="h2">
        {initialPackage
          ? copy("Edit rig package")
          : copy("Build a rig package")}
      </CardHeading>
      <p>
        {copy(
          " Select components in coupling order. Cargo is recorded on the run separately. ",
        )}
      </p>
      <fieldset disabled={busy || Boolean(attempt)} className="space-y-3">
        <label>
          {copy(" Rig package name ")}
          <input
            aria-label={copy("Rig package name")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {equipment
          .filter((item) => !["truck", "vehicle"].includes(item.category))
          .map((item) => {
            const component = components.find((row) => row.assetId === item.id);
            return (
              <div className="fleet-asset-fields" key={item.id}>
                <label className="flex items-center gap-2">
                  <BrandedCheckbox
                    aria-label={item.name}
                    checked={Boolean(component)}
                    onCheckedChange={(checked) =>
                      setComponents(
                        checked
                          ? [
                              ...components,
                              {
                                assetId: item.id,
                                role: roles.includes(
                                  item.category as (typeof roles)[number],
                                )
                                  ? (item.category as (typeof roles)[number])
                                  : "accessory",
                                sequence: components.length,
                              },
                            ]
                          : components.filter((row) => row.assetId !== item.id),
                      )
                    }
                  />
                  {item.name}
                </label>
                {component && (
                  <label>
                    {copy(" Component role ")}
                    <select
                      value={component.role}
                      onChange={(e) =>
                        setComponents(
                          components.map((row) =>
                            row.assetId === item.id
                              ? {
                                  ...row,
                                  role: e.target
                                    .value as (typeof roles)[number],
                                }
                              : row,
                          ),
                        )
                      }
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {copy(role)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            );
          })}
      </fieldset>
      <p>
        {components
          .map(
            (row, index) =>
              `${index + 1}. ${equipment.find((item) => item.id === row.assetId)?.name ?? row.role}`,
          )
          .join(" → ")}
      </p>
      {message && (
        <p role={message === "Rig package saved." ? "status" : "alert"}>
          {copy(message)}
        </p>
      )}
      {attempt ? (
        <>
          <PngPillButton disabled={busy} onClick={() => void save()}>
            {copy(" Save rig package ")}
          </PngPillButton>
          <PngPillButton disabled={busy} onClick={() => setAttempt(null)}>
            {copy(" Edit selection ")}
          </PngPillButton>
        </>
      ) : (
        <PngPillButton onClick={review}>
          {copy("Review rig package")}
        </PngPillButton>
      )}
    </section>
  );
}
