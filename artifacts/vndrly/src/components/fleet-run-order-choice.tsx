import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { FleetRunOrderSchema, type FleetRunOrder,type FleetWorkSession } from "@workspace/api-zod";
import { fleetClient } from "@/lib/fleet-client";
import { PngPillButton } from "./png-pill-rollover";

export function FleetRunOrderChoice({
  identity,
  companyId,
  groupId,
  disabled,
  onChange,
  onCanManage,
  workSession,
}: {
  workSession?:FleetWorkSession|null;
  identity: string;
  companyId: number;
  groupId: string;
  disabled: boolean;
  onChange: (order: FleetRunOrder | null) => void;
  onCanManage?: (allowed: boolean) => void;
}) {
  const { i18n } = useTranslation(),
    es = i18n.language.startsWith("es"),
    changed = useRef(onChange),
    generation = useRef(0),
    permission = useRef(onCanManage);
  changed.current = onChange;
  permission.current = onCanManage;
  const [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["fleet-run-orders", identity, groupId],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => workSession?workSession.runOrderChoices(pageParam):fleetClient.runOrders(pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  useEffect(() => {
    permission.current?.(
      !list.isError &&
        !!list.data?.pages.length &&
        list.data.pages.every((page) => page.canManage),
    );
    if (list.isError) changed.current(null);
  }, [list.isError, list.data]);
  useEffect(() => {
    generation.current++;
    setSelected("");
    setError("");
    setLoading(false);
    changed.current(null);
    return () => {
      generation.current++;
    };
  }, [identity, groupId, companyId]);
  const orders =
    (!list.isError ? list.data : undefined)?.pages
      .flatMap((page) => page.orders)
      .filter(
        (order) =>
          order.companyId === companyId &&
          order.accessGroupIds.includes(groupId) &&
          !order.archivedAt,
      ) ?? [];
  async function choose(id: string) {
    const expected = orders.find((order) => order.id === id),
      request = ++generation.current;
    setSelected(id);
    setError("");
    changed.current(null);
    if (!expected) return;
    setLoading(true);
    try {
      const saved = FleetRunOrderSchema.parse(workSession?await workSession.runOrder(id):await fleetClient.runOrder(id));
      if (request !== generation.current) return;
      if (
        saved.id !== id ||
        saved.companyId !== companyId ||
        saved.version !== expected.version ||
        saved.archivedAt ||
        !saved.accessGroupIds.includes(groupId)
      )
        throw new Error("Saved Run changed.");
      changed.current(saved);
    } catch {
      if (request === generation.current)
        setError(
          es
            ? "El recorrido cambió o no está disponible. Recargue y selecciónelo de nuevo."
            : "This Run changed or is unavailable. Reload and choose it again.",
        );
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }
  return (
    <div className="space-y-3 rounded-xl border-2 p-3">
      <p>
        {es
          ? "Un recorrido es una orden de transporte guardada entre origen y destino. Asígnele un destacamento y un ticket para esta actividad."
          : "A Run is a saved Origin and Destination transport order. Choose it, then assign your Detail and billing ticket for this activity."}
      </p>
      <label className="block">
        {es ? "Recorrido guardado" : "Saved Run"}
        <select
          aria-label={es ? "Recorrido guardado" : "Saved Run"}
          className="block w-full rounded border-2 p-2"
          value={selected}
          disabled={disabled || loading || list.isPending}
          onChange={(event) => void choose(event.target.value)}
        >
          <option value="">{es ? "Elegir recorrido" : "Choose Run"}</option>
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.name} · {order.origin.name} → {order.destination.name}
            </option>
          ))}
        </select>
      </label>
      {(error || list.isError) && (
        <p role="alert">
          {error ||
            (es
              ? "Recorridos no disponibles. Recargue para comprobar el acceso."
              : "Saved Runs unavailable. Reload to check access.")}
        </p>
      )}
      {list.hasNextPage && (
        <PngPillButton
          disabled={disabled || loading || list.isFetching}
          onClick={() => void list.fetchNextPage()}
        >
          {es ? "Cargar más recorridos" : "Load more Runs"}
        </PngPillButton>
      )}
      <PngPillButton
        disabled={disabled || loading || list.isFetching}
        onClick={() => {
          generation.current++;
          setSelected("");
          changed.current(null);
          void list.refetch();
        }}
      >
        {es ? "Recargar recorridos guardados" : "Reload saved Runs"}
      </PngPillButton>
    </div>
  );
}
