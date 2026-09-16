import { Handshake } from "lucide-react";
import { useState } from "react";

export default function PartnerApprovalLogo({ partnerId, partnerName, logoUrl, squareLogoUrl }: { partnerId: number; partnerName: string; logoUrl?: string | null; squareLogoUrl?: string | null }) {
  const [errored, setErrored] = useState(false);
  const source = squareLogoUrl?.trim() || logoUrl?.trim();
  if (!source || errored) return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--brand-primary)]/35 bg-white" data-testid={`icon-partner-row-${partnerId}`}><Handshake className="h-4 w-4 text-[var(--brand-primary)]" aria-hidden /></span>;
  return <img src={source} alt={`${partnerName} logo`} className="h-8 w-8 shrink-0 rounded-md border border-gray-200 bg-white object-contain" data-testid={`img-partner-row-${partnerId}`} onError={() => setErrored(true)} />;
}
