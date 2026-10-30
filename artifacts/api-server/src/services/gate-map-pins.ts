import { z } from "zod";
import { ChangeOverError, changeOverTransaction, requireChangeOverAccess } from "./gate-change-over";
import type { SessionPayload } from "../lib/session";

export const GateMapPinInput = z.object({
  id: z.string().uuid(), siteId: z.number().int().positive(),
  label: z.string().trim().min(1).max(100), notes: z.string().trim().max(2000),
  latitude: z.number().finite().min(-90).max(90), longitude: z.number().finite().min(-180).max(180),
}).strict();
export type GateMapPin = z.infer<typeof GateMapPinInput> & { createdById: number; createdAt: string; removedAt?: string | null; removedById?: number | null };

/** Pins belong to the active company and never confer access to another site. */
export async function saveGateMapPin(session: SessionPayload, value: unknown) {
  const input = GateMapPinInput.parse(value);
  if (!session.userId || !session.vendorId || session.realm === "demo" || session.publicDemo)
    throw new ChangeOverError(403, "gate_map.read_only", "A current company sign-in is required to save pins");
  return changeOverTransaction(async client => {
    await requireChangeOverAccess(client, session, input.siteId);
    const row = (await client.query("SELECT gate_map_pins FROM vendors WHERE id=$1 FOR UPDATE", [session.vendorId])).rows[0];
    if (!row) throw new ChangeOverError(403, "gate_map.company_required", "Company unavailable");
    const pins: GateMapPin[] = row.gate_map_pins ?? [];
    const existing = pins.find(pin => pin.id === input.id);
    if (existing) {
      if (Object.entries(input).some(([key, value]) => existing[key as keyof GateMapPin] !== value))
        throw new ChangeOverError(409, "gate_map.pin_conflict", "This pin was already saved with different details");
      return { pin: existing };
    }
    if (pins.length >= 500) throw new ChangeOverError(409, "gate_map.pin_limit", "This company has reached its saved pin limit");
    const pin: GateMapPin = { ...input, createdById: session.userId!, createdAt: new Date().toISOString() };
    await client.query("UPDATE vendors SET gate_map_pins=gate_map_pins || $2::jsonb WHERE id=$1", [session.vendorId, JSON.stringify([pin])]);
    return { pin };
  });
}

/** Soft removal preserves the pin record and permits an immediate Undo. */
export async function setGateMapPinRemoved(session: SessionPayload, pinId: string, removed: boolean) {
  z.string().uuid().parse(pinId);
  if (!session.userId || !session.vendorId || session.realm === "demo" || session.publicDemo)
    throw new ChangeOverError(403, "gate_map.read_only", "A current company sign-in is required to change pins");
  return changeOverTransaction(async client => {
    const row=(await client.query("SELECT gate_map_pins FROM vendors WHERE id=$1 FOR UPDATE",[session.vendorId])).rows[0];
    const pins:GateMapPin[]=row?.gate_map_pins??[];
    const pin=pins.find(value=>value.id===pinId);
    if(!pin)throw new ChangeOverError(404,"gate_map.pin_missing","Pin not found");
    await requireChangeOverAccess(client,session,pin.siteId);
    pin.removedAt=removed?pin.removedAt??new Date().toISOString():null;
    pin.removedById=removed?session.userId:null;
    await client.query("UPDATE vendors SET gate_map_pins=$2::jsonb WHERE id=$1",[session.vendorId,JSON.stringify(pins)]);
    return {pin};
  });
}
