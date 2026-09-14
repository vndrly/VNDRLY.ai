import type { OperationEnvelope, OperationReceipt } from "../../../../lib/api-zod/src/implementation-a/common";
import {
  executeWorkHubCommand,
  type WorkHubActor,
} from "../work-hub/commands";

type Owner = { type: "vendor" | "partner"; id: number };
type Context = {
  kind: "organization" | "ticket" | "site" | "crew" | "gate" | "chat";
  id: number | string;
};

type CommandResult<T> = {
  operationId: string;
  appliedAt: string;
  replayed: boolean;
  resource: T;
};

export type OperationExecutor = (
  actor: WorkHubActor,
  kind: string,
  envelope: {
    operationId: string;
    owner: Owner;
    context: Context;
    expectedVersion: number | null;
    payloadVersion: 1;
    payload: unknown;
  },
  apply: (tx: unknown) => Promise<unknown>,
  authorize?: (tx: unknown) => Promise<void>,
) => Promise<CommandResult<unknown>>;

type ExecuteInput<T> = {
  actor: WorkHubActor;
  kind: string;
  owner: Owner;
  context: Context;
  envelope: OperationEnvelope<unknown>;
  apply: (tx: unknown) => Promise<T>;
  authorize?: (tx: unknown) => Promise<void>;
  execute?: OperationExecutor;
  versionOf?: (resource: T) => number | null;
};

function defaultVersionOf<T>(resource: T): number | null {
  if (!resource || typeof resource !== "object" || !("version" in resource)) return null;
  const version = (resource as { version?: unknown }).version;
  return typeof version === "number" && Number.isInteger(version) && version >= 0
    ? version
    : null;
}

export async function executeIdempotentOperation<T>(
  input: ExecuteInput<T>,
): Promise<OperationReceipt<T>> {
  const execute = input.execute ?? (executeWorkHubCommand as unknown as OperationExecutor);
  const result = (await execute(
    input.actor,
    input.kind,
    {
      operationId: input.envelope.operationId,
      owner: input.owner,
      context: input.context,
      expectedVersion: input.envelope.expectedVersion ?? null,
      payloadVersion: 1,
      payload: input.envelope.payload,
    },
    input.apply as (tx: unknown) => Promise<unknown>,
    input.authorize,
  )) as CommandResult<T>;

  return {
    operationId: result.operationId,
    status: result.replayed ? "duplicate" : "applied",
    resource: result.resource,
    authoritativeVersion: (input.versionOf ?? defaultVersionOf)(result.resource),
  };
}
