import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FleetRunOrderSaveSchema,
  FleetRunOrderReceiptSchema,
  fleetRunOrderFromRoute,
  type FleetRunOrder,
  type FleetRoutePlan,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import { fleetClient } from "@/lib/fleet-client";
import { PngPillButton } from "./png-pill-rollover";

export function FleetSaveRunOrder({
  identity,
  companyId,
  groupId,
  route,
  timeZone,
  initialName = "",
  disabled,
  onPending,
  onSaved,
}: {
  identity: string;
  companyId: number;
  groupId: string;
  route: FleetRoutePlan;
  timeZone: string;
  initialName?: string;
  disabled: boolean;
  onPending: (pending: boolean) => void;
  onSaved: (order: FleetRunOrder) => void;
}) {
  const { i18n } = useTranslation(),
    es = i18n.language.startsWith("es"),
    scope = useRef(identity),
    latest = useRef(identity),
    alive = useRef(true),
    request = useRef<z.infer<typeof FleetRunOrderSaveSchema> | null>(null);
  latest.current = identity;
  const [name, setName] = useState(initialName),
    [pending, setPending] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const current = () => alive.current && scope.current === latest.current;
  async function save() {
    if (disabled || busy || !current()) return;
    try {
      if (!request.current)
        request.current = FleetRunOrderSaveSchema.parse({
          operationId: crypto.randomUUID(),
          expectedVersion: 0,
          order: fleetRunOrderFromRoute({
            id: crypto.randomUUID(),
            companyId,
            accessGroupIds: [groupId],
            name,
            timeZone,
            route,
          }),
        });
    } catch {
      setError(
        es
          ? "Nombre el recorrido y elija un par de origen y destino compatible."
          : "Name this Run and choose a matching Origin and Destination pair.",
      );
      return;
    }
    const body = request.current;
    setBusy(true);
    setPending(true);
    setError("");
    onPending(true);
    let accepted = false;
    try {
      await fleetClient.saveRunOrder(body);
      accepted = true;
      const receipt = FleetRunOrderReceiptSchema.parse(
        await fleetClient.runOrderReceipt(body.operationId),
      );
      if (!current()) return;
      if (
        receipt.operationId !== body.operationId ||
        JSON.stringify(receipt.order) !== JSON.stringify(body.order)
      )
        throw new Error("Saved Run readback changed.");
      request.current = null;
      setPending(false);
      onPending(false);
      onSaved(receipt.order);
    } catch (error) {
      if (!current()) return;
      const status = (error as { status?: number })?.status;
      if (
        !accepted &&
        status &&
        status >= 400 &&
        status < 500 &&
        ![408, 429].includes(status)
      ) {
        request.current = null;
        setPending(false);
        onPending(false);
      }
      setError(
        es
          ? "Debe verificarse el guardado. Reintente la misma solicitud; no se creó un ticket ni un destacamento."
          : "Run save needs verification. Retry the same request; no ticket or Detail was created.",
      );
    } finally {
      if (current()) setBusy(false);
    }
  }
  return (
    <div className="space-y-3 rounded-xl border-2 p-3">
      <p>
        {es
          ? "Guarde el par de origen y destino para despachos repetidos. Cada actividad requiere un ticket nuevo o compartido."
          : "Save the Origin and Destination pair for repeat dispatch. Each activity still needs its own new or shared ticket choice."}
      </p>
      <label className="block">
        {es ? "Nombre del recorrido guardado" : "Saved Run name"}
        <input
          className="block w-full rounded border-2 p-2"
          value={name}
          disabled={disabled || pending || busy}
          maxLength={200}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <PngPillButton
        disabled={disabled || busy || (!pending && !name.trim())}
        onClick={() => void save()}
      >
        {es
          ? pending
            ? "Reintentar guardar el recorrido"
            : "Guardar esta ruta como recorrido"
          : pending
            ? "Retry saving this Run"
            : "Save this route as a Run"}
      </PngPillButton>
      {!!error && <p role="alert">{error}</p>}
    </div>
  );
}
