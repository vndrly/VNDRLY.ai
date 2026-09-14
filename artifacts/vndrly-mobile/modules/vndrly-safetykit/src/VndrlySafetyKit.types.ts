export type VndrlySafetyKitEvents = {
  onSevereCrash: (event: { occurredAt: string; source: "apple" }) => void;
};

export type NativeSafetyCapability = {
  entitlement: boolean;
  supported: boolean;
  permission: boolean;
};
