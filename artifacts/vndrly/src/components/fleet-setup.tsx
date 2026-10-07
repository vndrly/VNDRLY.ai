import { FleetProfileFields } from "@/components/fleet-profile-fields";
import { FleetSupportGrants } from "@/components/fleet-support-grants";
import { useTranslation } from "react-i18next";
import { fleetCopy } from "@/lib/fleet-copy";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FleetSetupInputSchema, type FleetSetup } from "@workspace/api-zod";
import { fleetClient } from "@/lib/fleet-client";
import { PngPillButton } from "@/components/png-pill-rollover";

export function FleetSetupPanel({ identity }: { identity: string }) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const query = useQuery({
    queryKey: ["fleet-setup", identity],
    queryFn: fleetClient.setup,
    retry: false,
  });
  if (query.isPending) return <p>{c.setupLoading}</p>;
  if (!query.data) return <p role="alert">{c.setupDenied}</p>;
  return (
    <div className="space-y-3">
      <PngPillButton onClick={() => void query.refetch()}>
        {c.refreshConfiguration}
      </PngPillButton>
      <FleetSetupForm
        key={query.data.expectedVersion}
        initial={query.data}
        identity={identity}
      />
    </div>
  );
}
function FleetSetupForm({
  initial,
  identity,
}: {
  initial: FleetSetup;
  identity: string;
}) {
  const { i18n } = useTranslation();
  const c = fleetCopy(i18n.language);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fleetName, setFleetName] = useState("");
  const [memberId, setMemberId] = useState("");
  const sites = initial.sites.map((site) => ({
    id: site.siteId,
    name: site.name,
  }));
  function updateFleetSite(fleetId: string, siteId: number, checked: boolean) {
    const fleets = draft.fleets.map((fleet) =>
      fleet.id === fleetId
        ? {
            ...fleet,
            siteIds: checked
              ? [...fleet.siteIds, siteId]
              : fleet.siteIds.filter((id) => id !== siteId),
          }
        : fleet,
    );
    setDraft({
      ...draft,
      fleets,
      grants: draft.grants.map((grant) => ({
        ...grant,
        siteIds: grant.siteIds.filter((id) =>
          fleets.some(
            (fleet) =>
              grant.fleetIds.includes(fleet.id) && fleet.siteIds.includes(id),
          ),
        ),
      })),
    });
  }
  const updateGrant = (
    userId: number,
    fields: Partial<FleetSetup["grants"][number]>,
  ) =>
    setDraft({
      ...draft,
      grants: draft.grants.map((g) =>
        g.userId === userId ? { ...g, ...fields } : g,
      ),
    });
  async function save() {
    setBusy(true);
    setMessage("");
    try {
      await fleetClient.saveSetup(
        FleetSetupInputSchema.parse({
          expectedVersion: draft.expectedVersion,
          enabled: draft.enabled,
          fleets: draft.fleets,
          grants: draft.grants,
          ...(draft.supportGrants !== undefined
            ? { supportGrants: draft.supportGrants }
            : {}),
        }),
      );
      setMessage(c.setupSaved);
      await queryClient.invalidateQueries({ queryKey: ["fleet", identity] });
      await queryClient.invalidateQueries({
        queryKey: ["fleet-setup", identity],
      });
    } catch {
      setMessage(c.setupFailed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border p-4">
      <h2 className="text-xl font-semibold">{c.setup}</h2>
      <p className="text-sm">{c.setupExplanation}</p>
      <label>
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={busy}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />{" "}
        {c.enableFleet}
      </label>
      <div className="space-y-3">
        <h3 className="font-semibold">{c.fleetsSites}</h3>
        {draft.fleets.map((fleet) => (
          <fieldset className="rounded border p-3" key={fleet.id}>
            <legend>{fleet.name}</legend>
            <FleetProfileFields
              disabled={busy}
              value={fleet.operationalProfile}
              onChange={(operationalProfile) =>
                setDraft({
                  ...draft,
                  fleets: draft.fleets.map((item) =>
                    item.id === fleet.id
                      ? { ...item, operationalProfile }
                      : item,
                  ),
                })
              }
            />
            <div className="space-y-1">
              <h4 className="text-sm font-semibold">{c.assignedEquipment}</h4>
              {initial.equipment.map((asset) => (
                <label className="mr-4 inline-block" key={asset.assetId}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={fleet.equipmentAssetIds.includes(asset.assetId)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        fleets: draft.fleets.map((f) =>
                          f.id === fleet.id
                            ? {
                                ...f,
                                equipmentAssetIds: e.target.checked
                                  ? [...f.equipmentAssetIds, asset.assetId]
                                  : f.equipmentAssetIds.filter(
                                      (id) => id !== asset.assetId,
                                    ),
                              }
                            : f,
                        ),
                      })
                    }
                  />{" "}
                  {asset.name} · {asset.category}
                </label>
              ))}
            </div>
            <label className="block text-sm">
              {c.certifications}
              <textarea
                disabled={busy}
                className="block w-full rounded border bg-background p-2"
                value={fleet.requiredCertifications.join("\n")}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    fleets: draft.fleets.map((f) =>
                      f.id === fleet.id
                        ? {
                            ...f,
                            requiredCertifications: [
                              ...new Set(
                                e.target.value
                                  .split("\n")
                                  .map((value) => value.trim())
                                  .filter(Boolean),
                              ),
                            ],
                          }
                        : f,
                    ),
                  })
                }
              />
            </label>
            {sites.map((site) => (
              <label className="mr-4 inline-block" key={site.id}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={fleet.siteIds.includes(site.id)}
                  onChange={(e) =>
                    updateFleetSite(fleet.id, site.id, e.target.checked)
                  }
                />{" "}
                {site.name}
              </label>
            ))}
          </fieldset>
        ))}
        <input
          aria-label={c.newFleet}
          placeholder={c.newFleet}
          value={fleetName}
          disabled={busy}
          onChange={(e) => setFleetName(e.target.value)}
        />
        <PngPillButton
          disabled={busy || !fleetName.trim()}
          onClick={() => {
            setDraft({
              ...draft,
              fleets: [
                ...draft.fleets,
                {
                  id: crypto.randomUUID(),
                  name: fleetName.trim(),
                  siteIds: [],
                  requiredCertifications: [],
                  equipmentAssetIds: [],
                },
              ],
            });
            setFleetName("");
          }}
        >
          {c.addFleet}
        </PngPillButton>
      </div>
      <div className="space-y-3">
        <h3 className="font-semibold">{c.memberGrants}</h3>
        {draft.grants.map((grant) => (
          <fieldset key={grant.userId} className="space-y-2 rounded border p-3">
            <legend>
              {initial.members.find((member) => member.userId === grant.userId)
                ?.name ?? `${c.member} ${grant.userId}`}
            </legend>
            <div>
              {(["fleet_manager", "dispatcher", "driver"] as const).map(
                (role) => (
                  <label className="mr-4" key={role}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={grant.roles.includes(role)}
                      onChange={(e) =>
                        updateGrant(grant.userId, {
                          roles: e.target.checked
                            ? [...grant.roles, role]
                            : grant.roles.filter((r) => r !== role),
                        })
                      }
                    />{" "}
                    {c[role]}
                  </label>
                ),
              )}
            </div>
            <div>
              {draft.fleets.map((fleet) => (
                <label className="mr-4" key={fleet.id}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={grant.fleetIds.includes(fleet.id)}
                    onChange={(e) =>
                      updateGrant(grant.userId, {
                        fleetIds: e.target.checked
                          ? [...grant.fleetIds, fleet.id]
                          : grant.fleetIds.filter((id) => id !== fleet.id),
                        siteIds: e.target.checked
                          ? grant.siteIds
                          : grant.siteIds.filter((id) =>
                              draft.fleets.some(
                                (f) =>
                                  f.id !== fleet.id &&
                                  grant.fleetIds.includes(f.id) &&
                                  f.siteIds.includes(id),
                              ),
                            ),
                      })
                    }
                  />{" "}
                  {fleet.name}
                </label>
              ))}
            </div>
            <div>
              {sites
                .filter((site) =>
                  draft.fleets.some(
                    (f) =>
                      grant.fleetIds.includes(f.id) &&
                      f.siteIds.includes(site.id),
                  ),
                )
                .map((site) => (
                  <label className="mr-4" key={site.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={grant.siteIds.includes(site.id)}
                      onChange={(e) =>
                        updateGrant(grant.userId, {
                          siteIds: e.target.checked
                            ? [...grant.siteIds, site.id]
                            : grant.siteIds.filter((id) => id !== site.id),
                        })
                      }
                    />{" "}
                    {site.name}
                  </label>
                ))}
            </div>
            <div className="space-y-2">
              {(["safetyRelease", "financeRead"] as const).map((authority) => (
                <label className="block" key={authority}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={grant[authority]}
                    onChange={(event) =>
                      updateGrant(grant.userId, {
                        [authority]: event.target.checked,
                      })
                    }
                  />{" "}
                  {c[authority]}
                </label>
              ))}
            </div>
            <PngPillButton
              color="red"
              disabled={busy}
              onClick={() =>
                setDraft({
                  ...draft,
                  grants: draft.grants.filter((g) => g.userId !== grant.userId),
                })
              }
            >
              {c.removeGrant}
            </PngPillButton>
          </fieldset>
        ))}
        <select
          aria-label={c.member}
          disabled={busy}
          value={memberId}
          onChange={(e) => setMemberId(e.target.value)}
        >
          <option value="">{c.chooseMember}</option>
          {initial.members
            .filter(
              (member) => !draft.grants.some((g) => g.userId === member.userId),
            )
            .map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
        </select>
        <PngPillButton
          disabled={busy || !memberId}
          onClick={() => {
            setDraft({
              ...draft,
              grants: [
                ...draft.grants,
                {
                  userId: Number(memberId),
                  roles: [],
                  fleetIds: [],
                  siteIds: [],
                  safetyRelease: false,
                  financeRead: false,
                },
              ],
            });
            setMemberId("");
          }}
        >
          {c.addGrant}
        </PngPillButton>
      </div>
      <FleetSupportGrants
        draft={draft}
        onChange={(supportGrants) => setDraft({ ...draft, supportGrants })}
      />
      <p className="text-xs">{c.separateAuthorities}</p>
      <PngPillButton disabled={busy} onClick={() => void save()}>
        {c.saveConfiguration}
      </PngPillButton>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
