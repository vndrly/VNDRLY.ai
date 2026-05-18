// Web-side adapter over the cross-platform ticket-status metadata.
//
// The canonical map (label keys, color buckets, action-pill
// descriptors) lives in the shared `@workspace/ticket-status-meta`
// lib so the office web app and the field mobile app cannot drift
// apart on user-facing status text. This file re-exports the shared
// types/data and resolves the framework-agnostic icon identifiers
// to the actual `lucide-react` components that the web ticket
// detail header renders.
import {
  CheckCircle2,
  DollarSign,
  RotateCcw,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  ticketStatusMeta as sharedTicketStatusMeta,
  type TicketStatusActionPillIcon,
  type TicketStatusActionPillMeta as SharedTicketStatusActionPillMeta,
  type TicketStatusActionPillVariant,
  type TicketStatusBadgeColor,
  type TicketStatusMeta as SharedTicketStatusMeta,
} from "@workspace/ticket-status-meta";

export type {
  TicketStatusActionPillVariant,
  TicketStatusBadgeColor,
};

const ICONS: Record<TicketStatusActionPillIcon, LucideIcon> = {
  "check-circle-2": CheckCircle2,
  "dollar-sign": DollarSign,
  "rotate-ccw": RotateCcw,
  send: Send,
  "x-circle": XCircle,
};

export interface TicketStatusActionPillMeta
  extends Omit<SharedTicketStatusActionPillMeta, "icon"> {
  icon: LucideIcon;
}

export interface TicketStatusMeta
  extends Omit<SharedTicketStatusMeta, "actionPill"> {
  actionPill: TicketStatusActionPillMeta | null;
}

function resolveActionPill(
  pill: SharedTicketStatusActionPillMeta | null,
): TicketStatusActionPillMeta | null {
  if (!pill) return null;
  return {
    variant: pill.variant,
    labelKey: pill.labelKey,
    icon: ICONS[pill.icon],
  };
}

export const ticketStatusMeta: Record<string, TicketStatusMeta> =
  Object.fromEntries(
    Object.entries(sharedTicketStatusMeta).map(([status, meta]) => [
      status,
      {
        badgeColor: meta.badgeColor,
        badgeLabelKey: meta.badgeLabelKey,
        testIdStem: meta.testIdStem,
        actionPill: resolveActionPill(meta.actionPill),
      },
    ]),
  );
