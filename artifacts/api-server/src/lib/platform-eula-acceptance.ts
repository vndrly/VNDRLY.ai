import {
  PLATFORM_EULA_TEXT,
  PLATFORM_EULA_VERSION,
} from "@workspace/platform-eula";
import { sha256Hex } from "./hash";

export { PLATFORM_EULA_VERSION, PLATFORM_EULA_TEXT };

export function platformEulaContentHash(): string {
  return sha256Hex(PLATFORM_EULA_TEXT);
}

export function isPlatformEulaPayloadAccepted(
  payload: Record<string, unknown>,
): boolean {
  const eula = (payload.platformEula ?? {}) as Record<string, unknown>;
  if (eula.accepted !== true) return false;
  const version = typeof eula.version === "string" ? eula.version.trim() : "";
  return version === PLATFORM_EULA_VERSION;
}

export interface PlatformEulaAcceptancePatch {
  platformEulaAcceptedAt: Date;
  platformEulaVersion: string;
  platformEulaHash: string;
  platformEulaAcceptedByUserId: number;
}

export function buildPlatformEulaAcceptancePatch(
  userId: number,
): PlatformEulaAcceptancePatch {
  return {
    platformEulaAcceptedAt: new Date(),
    platformEulaVersion: PLATFORM_EULA_VERSION,
    platformEulaHash: platformEulaContentHash(),
    platformEulaAcceptedByUserId: userId,
  };
}
