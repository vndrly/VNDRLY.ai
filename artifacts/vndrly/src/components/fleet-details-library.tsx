import { useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { FleetDetail, FleetRigPackage } from "@workspace/api-zod";
import { fleetClient } from "@/lib/fleet-client";
import { FleetDetailBuilder, FleetRigPackageBuilder } from "./fleet-details";
import { PngPillButton } from "./png-pill-rollover";

export function FleetDetailsLibrary({ identity }: { identity: string }) {
  const cache = useQueryClient(),
    [group, setGroup] = useState(""),
    [selected, setSelected] = useState<FleetDetail | undefined>(),
    [rigView, setRigView] = useState(false),
    [selectedRig, setSelectedRig] = useState<FleetRigPackage | undefined>();
  const context = useQuery({
    queryKey: ["fleet-details-context", identity],
    queryFn: async () => {
      const [overview, resources] = await Promise.all([
        fleetClient.overview(),
        fleetClient.resources(),
      ]);
      return { overview, resources };
    },
    retry: false,
  });
  const details = useInfiniteQuery({
    queryKey: ["fleet-details", identity],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fleetClient.details(pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const rigs = useInfiniteQuery({
    queryKey: ["fleet-rig-packages", identity],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => fleetClient.rigPackages(pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  async function reload() {
    await Promise.all([
      cache.invalidateQueries({ queryKey: ["fleet-details", identity] }),
      cache.invalidateQueries({ queryKey: ["fleet-rig-packages", identity] }),
    ]);
  }
  if (context.isError || details.isError || rigs.isError)
    return (
      <p role="alert">Details unavailable. Refresh to check current access.</p>
    );
  if (!context.data || !details.data || !rigs.data)
    return <p>Loading Details…</p>;
  const { overview, resources } = context.data,
    groups = overview.fleets,
    accessGroupId = group || groups[0]?.id;
  const packages = rigs.data.pages.flatMap((page) => page.rigPackages),
    rows = details.data.pages.flatMap((page) => page.details),
    manage = details.data.pages[0].canManage;
  return (
    <div className="space-y-4">
      <section className="space-y-3">
        <h2>Reusable Details</h2>
        <p>
          A Detail combines a truck, optional rig package and driver. Each run
          reserves its own immutable assignment.
        </p>
        <PngPillButton
          onClick={() => {
            setRigView(false);
            setSelected(undefined);
          }}
        >
          Build Detail
        </PngPillButton>
        <PngPillButton
          onClick={() => {
            setRigView(true);
            setSelectedRig(undefined);
          }}
        >
          Rig packages
        </PngPillButton>
      </section>
      {manage && (
        <>
          {!rigView ? (
            <>
              <label>
                Dispatch access
                <select
                  value={accessGroupId ?? ""}
                  onChange={(e) => setGroup(e.target.value)}
                >
                  {groups.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <FleetDetailBuilder
                key={`${selected?.id ?? "new"}:${selected?.version ?? 0}:${accessGroupId}`}
                companyId={overview.companyId}
                accessGroupIds={
                  selected?.accessGroupIds ??
                  (accessGroupId ? [accessGroupId] : [])
                }
                resources={resources}
                rigPackages={packages}
                initialDetail={selected}
                onSave={async (input) => {
                  await fleetClient.saveDetail(input);
                  setSelected(undefined);
                  await reload();
                }}
              />
            </>
          ) : (
            <FleetRigPackageBuilder
              key={`${selectedRig?.id ?? "new"}:${selectedRig?.version ?? 0}`}
              companyId={overview.companyId}
              equipment={resources.equipment}
              initialPackage={selectedRig}
              onSave={async (input) => {
                await fleetClient.saveRigPackage(input);
                setSelectedRig(undefined);
                await reload();
              }}
            />
          )}
        </>
      )}
      <div className="fleet-asset-grid">
        {rigView
          ? packages.map((item) => (
              <article key={item.id} className="fleet-detail-group">
                <h3>{item.name}</h3>
                <p>
                  Revision {item.version} · {item.components.length} components
                </p>
                <ol>
                  {item.components.map((member) => (
                    <li key={member.assetId}>
                      {resources.equipment.find(
                        (asset) => asset.id === member.assetId,
                      )?.name ?? member.role}
                    </li>
                  ))}
                </ol>
                {manage && (
                  <PngPillButton onClick={() => setSelectedRig(item)}>
                    Edit {item.name}
                  </PngPillButton>
                )}
              </article>
            ))
          : rows.map((item) => (
              <article key={item.id} className="fleet-detail-group">
                <h3>{item.name}</h3>
                <p>
                  {resources.equipment.find(
                    (asset) => asset.id === item.vehicleAssetId,
                  )?.name ?? "Truck"}{" "}
                  ·{" "}
                  {resources.drivers.find(
                    (driver) => driver.userId === item.driverUserId,
                  )?.name ?? "Assigned driver"}
                </p>
                <p>
                  {packages.find((rig) => rig.id === item.rigPackageId)?.name ??
                    "No towed package"}{" "}
                  · revision {item.version}
                </p>
                {manage && (
                  <PngPillButton
                    onClick={() => {
                      setSelected(item);
                      setRigView(false);
                    }}
                  >
                    Edit {item.name}
                  </PngPillButton>
                )}
              </article>
            ))}
      </div>
      {details.hasNextPage && (
        <PngPillButton
          disabled={details.isFetchingNextPage}
          onClick={() => void details.fetchNextPage()}
        >
          Load more Details
        </PngPillButton>
      )}
      {rigs.hasNextPage && (
        <PngPillButton
          disabled={rigs.isFetchingNextPage}
          onClick={() => void rigs.fetchNextPage()}
        >
          Load more rig packages
        </PngPillButton>
      )}
    </div>
  );
}
