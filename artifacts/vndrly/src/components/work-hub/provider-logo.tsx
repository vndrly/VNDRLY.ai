import { providerSvg } from "./provider-artwork";
import type { HTMLAttributes } from "react";

export type CommunicationProvider = "teams" | "outlook" | "gmail" | "slack";
export function ProviderLogo({ provider, className = "h-6 w-6", ...props }: HTMLAttributes<HTMLSpanElement> & { provider: CommunicationProvider | "google-calendar" }) {
  return <span {...props} className={`inline-flex shrink-0 items-center justify-center ${className}`}>
    <img src={provider === "slack" ? "/images/providers/slack.png" : `data:image/svg+xml,${encodeURIComponent(providerSvg[provider])}`} alt="" aria-hidden="true" className="h-full w-full object-contain" style={{ filter: "none", background: "transparent" }} />
  </span>;
}
export const TeamsLogo = (props: HTMLAttributes<HTMLSpanElement>) => <ProviderLogo {...props} provider="teams" />;
export const OutlookLogo = (props: HTMLAttributes<HTMLSpanElement>) => <ProviderLogo {...props} provider="outlook" />;
export const GmailLogo = (props: HTMLAttributes<HTMLSpanElement>) => <ProviderLogo {...props} provider="gmail" />;
export const SlackLogo = (props: HTMLAttributes<HTMLSpanElement>) => <ProviderLogo {...props} provider="slack" />;
