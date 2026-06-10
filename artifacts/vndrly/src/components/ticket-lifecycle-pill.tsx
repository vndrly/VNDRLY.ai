import { useTranslation } from "react-i18next";
import LifecycleStatePill from "@/components/lifecycle-state-pill";

const LIFECYCLE_STATES = {
  pending_arrival: {
    labelKey: "tickets.lifecyclePendingArrival",
    titleKey: "tickets.lifecyclePendingArrivalTitle",
    slug: "pending-arrival",
  },
  en_route: {
    labelKey: "tickets.lifecycleEnRoute",
    titleKey: "tickets.lifecycleEnRouteTitle",
    slug: "en-route",
  },
  on_site: {
    labelKey: "tickets.lifecycleOnSite",
    titleKey: "tickets.lifecycleOnSiteTitle",
    slug: "on-site",
  },
  off_site: {
    labelKey: "tickets.lifecycleOffSite",
    titleKey: "tickets.lifecycleOffSiteTitle",
    slug: "off-site",
  },
} as const;

type LifecycleState = keyof typeof LIFECYCLE_STATES;

export default function TicketLifecyclePill({
  state,
  testId,
  idSuffix,
  testIdPrefix = "badge",
}: {
  state: string | null | undefined;
  /** Full data-testid override. */
  testId?: string;
  /** Builds `{testIdPrefix}-{slug}-{idSuffix}` when testId omitted. */
  idSuffix?: string | number;
  testIdPrefix?: string;
}) {
  const { t } = useTranslation();
  if (!state || !(state in LIFECYCLE_STATES)) return null;
  const cfg = LIFECYCLE_STATES[state as LifecycleState];
  const resolvedTestId =
    testId ??
    (idSuffix != null ? `${testIdPrefix}-${cfg.slug}-${idSuffix}` : `${testIdPrefix}-${cfg.slug}`);
  return (
    <LifecycleStatePill
      data-testid={resolvedTestId}
      title={t(cfg.titleKey, { defaultValue: cfg.slug })}
    >
      {t(cfg.labelKey, { defaultValue: cfg.slug })}
    </LifecycleStatePill>
  );
}
