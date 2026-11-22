import { useTranslation } from "react-i18next";
import { canUseOfficeNavigation } from "@/lib/office-navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Fragment, type ReactNode } from "react";
import { ArrowLeft, BookOpen, User } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { workHubRequest } from "@/lib/work-hub-client";
import {
  DEFAULT_WORK_HUB_PINS,
  getWorkHubNavItems,
  orderWorkHubItems,
  workHubIcons,
} from "@/lib/work-hub-nav";
import SidebarButton from "@/components/sidebar-button";
export type HubPreferences = {
  pinned: string[];
  order: string[];
  favorites: string[];
  muted: string[];
  drafts: Record<string, string>;
  lastConversationId: string | null;
};
const defaults: HubPreferences = {
  pinned: DEFAULT_WORK_HUB_PINS,
  order: [],
  favorites: [],
  muted: [],
  drafts: {},
  lastConversationId: null,
};
export function useHubPreferences(enabled = true) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["work-hub", "preferences", user?.userId];
  const query = useQuery<HubPreferences>({
    queryKey: key,
    queryFn: () => workHubRequest("/preferences"),
    enabled: enabled && !!user,
    staleTime: 60_000,
  });
  const save = useMutation({
    mutationFn: async (patch: Partial<HubPreferences>) => {
      const current = qc.getQueryData<HubPreferences>(key) ?? defaults;
      return workHubRequest<HubPreferences>("/preferences", {
        method: "PUT",
        body: JSON.stringify({ ...current, ...patch }),
      });
    },
    onSuccess: (result) => qc.setQueryData(key, result),
  });
  return { ...query, preferences: { ...defaults, ...query.data }, save };
}
export function WorkHubNavigation({ onNavigate, footer }: { onNavigate?: () => void; footer?: ReactNode }) {
  const [location] = useLocation();
  const brand = useBrand();
  const { user } = useAuth();
  const { t } = useTranslation();
  const office = canUseOfficeNavigation(user);
  const { preferences } = useHubPreferences();
  const items = orderWorkHubItems(
    getWorkHubNavItems(undefined, brand.name),
    preferences.order,
  );
  const profileLink = (
      <Link href="/work-hub/profile" onClick={onNavigate} className="block" data-testid="nav-profile" aria-current={location.startsWith("/work-hub/profile") ? "page" : undefined}>
        <SidebarButton isActive={location.startsWith("/work-hub/profile")}>
          <User className="h-4 w-4 shrink-0" strokeWidth={1.6} />
          <span>{t("gateNav.profile")}</span>
        </SidebarButton>
      </Link>
  );
  const render = (item: (typeof items)[number]) => {
    const Icon = workHubIcons[item.key as keyof typeof workHubIcons];
    const selected =
      location === item.href ||
      (item.href !== "/work-hub" && location.startsWith(item.href));
    return (
      <Fragment key={item.key}><div className="relative">
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={selected ? "page" : undefined}
          data-testid={`nav-${item.key}`}
          className="block"
        >
          <SidebarButton
            isActive={selected}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.6} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
          </SidebarButton>
        </Link>
      </div>{item.key === "activity" && profileLink}</Fragment>
    );
  };
  return (
    <div className="space-y-0" aria-label="Work Hub navigation">
      {items.filter(item => item.key !== "askv").filter(item => office || preferences.pinned.includes(item.key)).map(render)}
      {(office || preferences.pinned.includes("askv")) && items.filter(item => item.key === "askv").map(render)}
      <Link href="/work-hub/library" onClick={onNavigate} className="block" data-testid="nav-library" aria-current={location.startsWith("/work-hub/library") ? "page" : undefined}>
        <SidebarButton isActive={location.startsWith("/work-hub/library")}>
          <BookOpen className="h-4 w-4 shrink-0" strokeWidth={1.6} />
          <span>VNDRLY/U</span>
        </SidebarButton>
      </Link>

      {!office && !preferences.pinned.includes("activity") && profileLink}
      {office && <>
      <Link href="/" onClick={onNavigate} className="block w-full text-left" data-testid="nav-go-to-admin">
        <SidebarButton isActive={false}><ArrowLeft className="h-4 w-4" />{t("gateNav.returnToAdmin")}</SidebarButton>
      </Link>
      </>}
      {footer}

    </div>
  );
}

