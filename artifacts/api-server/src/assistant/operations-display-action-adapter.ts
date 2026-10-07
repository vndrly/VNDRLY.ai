import { operationsDisplayCommandSchema } from "./operations-display-commands";

/** Transport context never substitutes for canonical persisted authorization. */
export function displayActionCommand(input: Record<string, unknown>, preparation = false) {
  const { owner: _owner, context: _context, confirmed: _confirmed, ...command } = input;
  return operationsDisplayCommandSchema.parse(preparation ? { ...command, operationId: "00000000-0000-4000-8000-000000000001" } : command);
}

export function displayActionRequest(input: Record<string, unknown>, readback = false) {
  return { method: "POST" as const, path: `/implementation-a/operations-displays/commands${readback ? "/readback" : ""}`, body: displayActionCommand(input) };
}
