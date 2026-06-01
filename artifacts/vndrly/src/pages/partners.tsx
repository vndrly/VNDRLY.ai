import { useEffect, useState } from "react";
import {
  useListPartners,
  useCreatePartner,
  getListPartnersQueryKey,
  matchPartner,
} from "@workspace/api-client-react";
import type { MatchPartnerResponseItem } from "@workspace/api-client-react";
import { formatPhone, handlePhoneInput, stripPhone } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import SphereBackButton from "@/components/sphere-back-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Handshake, ArrowUp, ArrowDown, AlertTriangle, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import BlueButton from "@/components/blue-button";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import { useTranslation } from "react-i18next";
import { PosterThumbnail } from "@/components/poster-preview";

// Small presentational component so each row's logo can independently track
// load failures. If the partner has no logoUrl OR the image fails to load,
// fall back to the historical Handshake icon. Keeps the row visually stable.
function PartnerRowLogo({
  logoUrl,
  name,
  partnerId,
  altText,
  fallbackColor,
}: {
  logoUrl: string | null | undefined;
  name: string;
  partnerId: number;
  altText: string;
  fallbackColor: string;
}) {
  const [errored, setErrored] = useState(false);
  const trimmed = typeof logoUrl === "string" ? logoUrl.trim() : "";
  if (!trimmed || errored) {
    return <Handshake className="w-4 h-4 shrink-0" style={{ color: fallbackColor }} data-testid={`icon-partner-row-fallback-${partnerId}`} />;
  }
  return (
    <img
      src={trimmed}
      alt={altText || `${name} logo`}
      className="w-6 h-6 rounded-sm object-contain bg-white border border-gray-200 shrink-0"
      data-testid={`img-partner-row-logo-${partnerId}`}
      onError={() => setErrored(true)}
    />
  );
}

export default function Partners() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const brand = useBrand();
  const accentColor = brand.isOrgBranded ? brand.primary : "#f59e0b";
  const iconStyle = { color: accentColor };
  const isVendor = user?.role === "vendor" && user.vendorId;

  const { data: partners, isLoading } = useListPartners();
  const createPartner = useCreatePartner();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", contactName: "", contactEmail: "", contactPhone: "", physicalAddress: "", billingAddress: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [matches, setMatches] = useState<MatchPartnerResponseItem[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  // The name the most recent match call resolved for; gates submit so
  // a fast Enter can't slip through before the debounced check fires.
  const [checkedName, setCheckedName] = useState<string | null>(null);
  const [confirmDifferent, setConfirmDifferent] = useState(false);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sortIcon = (col: string) => {
    if (sortCol !== col) return null;
    return sortDir === "asc" ? <ArrowUp className="w-3.5 h-3.5" style={iconStyle} /> : <ArrowDown className="w-3.5 h-3.5" style={iconStyle} />;
  };

  const sortedPartners = (() => {
    if (!partners || !sortCol) return partners;
    return [...partners].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortCol) {
        case "name": aVal = a.name.toLowerCase(); bVal = b.name.toLowerCase(); break;
        case "contact": aVal = (a.contactName || "").toLowerCase(); bVal = (b.contactName || "").toLowerCase(); break;
        case "email": aVal = (a.contactEmail || "").toLowerCase(); bVal = (b.contactEmail || "").toLowerCase(); break;
        case "phone": aVal = a.contactPhone || ""; bVal = b.contactPhone || ""; break;
        case "created": aVal = a.createdAt; bVal = b.createdAt; break;
        default: return 0;
      }
      if (aVal < bVal) return sortDir === "asc" ? -1 : 1;
      if (aVal > bVal) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  })();

  // Debounced fuzzy lookup; AbortController prevents stale responses
  // from overwriting state for a newer name.
  useEffect(() => {
    if (!open) return;
    const trimmed = form.name.trim();
    setConfirmDifferent(false);
    if (trimmed.length < 3) {
      setMatches([]);
      setMatchesLoading(false);
      setCheckedName(trimmed);
      return;
    }
    setCheckedName(null);
    setMatchesLoading(true);
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        const res = await matchPartner(
          { name: trimmed },
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setMatches(res.matches);
        setCheckedName(trimmed);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === "AbortError")
        ) {
          return;
        }
        setMatches([]);
        setCheckedName(null);
      } finally {
        if (!controller.signal.aborted) setMatchesLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [form.name, open]);

  useEffect(() => {
    if (open) {
      setMatches([]);
      setConfirmDifferent(false);
      setCheckedName(null);
    }
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = form.name.trim();
    if (trimmed.length >= 3 && (matchesLoading || checkedName !== trimmed)) {
      toast({
        title: t("partners.duplicateChecking", {
          defaultValue: "Checking for similar partners…",
        }),
      });
      return;
    }
    if (matches.length > 0 && !confirmDifferent) {
      toast({
        title: t("partners.duplicateConfirmRequired", {
          defaultValue:
            "Please confirm this is a different partner before continuing.",
        }),
        variant: "destructive",
      });
      return;
    }
    createPartner.mutate(
      { data: { ...form, contactPhone: stripPhone(form.contactPhone) || null, physicalAddress: form.physicalAddress || null, billingAddress: form.billingAddress || null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPartnersQueryKey() });
          setOpen(false);
          setForm({ name: "", contactName: "", contactEmail: "", contactPhone: "", physicalAddress: "", billingAddress: "" });
          setMatches([]);
          setConfirmDifferent(false);
          toast({ title: t("partners.createSuccess") });
        },
        onError: () => {
          toast({ title: t("partners.createFailed"), variant: "destructive" });
        },
      },
    );
  };

  const trimmedName = form.name.trim();
  const checkPending =
    trimmedName.length >= 3 && (matchesLoading || checkedName !== trimmedName);
  const submitDisabled =
    createPartner.isPending ||
    checkPending ||
    (matches.length > 0 && !confirmDifferent);

  return (
    <div className="space-y-6" data-testid="partners-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="group inline-flex items-center" aria-label="Back" data-testid="button-back"><SphereBackButton size={40} /></Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">{t("partners.title")}</h1>
            <p className="text-muted-foreground text-sm mt-1">{isVendor ? t("partners.subtitleVendor", { defaultValue: "Partners you are working with" }) : t("partners.subtitleAdmin", { defaultValue: "Manage partner companies" })}</p>
          </div>
        </div>
        {!isVendor && <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <PngPillButton color="blue" data-testid="button-add-partner" className="px-2"><Plus className="w-4 h-4" />{t("partners.addPartner")}</PngPillButton>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t("partners.addPartner")}</DialogTitle></DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label>{t("partners.companyName")}</Label>
                <Input data-testid="input-partner-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                {matches.length > 0 && (
                  <div
                    role="alert"
                    data-testid="partner-duplicate-warning"
                    className="mt-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
                      <div className="flex-1 space-y-1.5">
                        <p className="font-medium">
                          {t("partners.duplicateWarningTitle", {
                            defaultValue:
                              "This name looks similar to existing partners.",
                          })}
                        </p>
                        <ul className="space-y-0.5">
                          {matches.map((m) => (
                            <li key={m.id}>
                              {t("partners.duplicateWarningSuggestion", {
                                defaultValue: "Did you mean ",
                              })}
                              <Link
                                href={`/partners/${m.id}`}
                                className="font-semibold underline hover:text-amber-700"
                                data-testid={`link-duplicate-partner-${m.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {m.name}
                              </Link>
                              ?
                            </li>
                          ))}
                        </ul>
                        <label className="mt-1 flex items-center gap-2 text-amber-900">
                          <Checkbox
                            data-testid="checkbox-confirm-different-partner"
                            checked={confirmDifferent}
                            onCheckedChange={(c) => setConfirmDifferent(c === true)}
                          />
                          <span>
                            {t("partners.duplicateConfirmLabel", {
                              defaultValue:
                                "I'm sure this is a different partner — create it anyway.",
                            })}
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}
                {matchesLoading && matches.length === 0 && form.name.trim().length >= 3 && (
                  <p className="mt-1 text-xs text-muted-foreground" data-testid="partner-match-loading">
                    {t("partners.duplicateChecking", { defaultValue: "Checking for similar partners…" })}
                  </p>
                )}
              </div>
              <div><Label>{t("partners.contactName")}</Label><Input data-testid="input-contact-name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} required /></div>
              <div><Label>{t("partners.contactEmail")}</Label><Input data-testid="input-contact-email" type="email" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} required /></div>
              <div><Label>{t("partners.contactPhone")}</Label><Input data-testid="input-contact-phone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: handlePhoneInput(e.target.value) })} /></div>
              <div><Label>{t("partners.physicalAddress")}</Label><Input data-testid="input-physical-address" value={form.physicalAddress} onChange={(e) => setForm({ ...form, physicalAddress: e.target.value })} placeholder={t("partners.addressPlaceholder")} /></div>
              <div><Label>{t("partners.billingAddress")}</Label><Input data-testid="input-billing-address" value={form.billingAddress} onChange={(e) => setForm({ ...form, billingAddress: e.target.value })} placeholder={t("partners.addressPlaceholder")} /></div>
              <PngPillButton color="blue" type="submit" disabled={submitDisabled} data-testid="button-submit-partner" className="w-full">{createPartner.isPending ? t("partners.creating") : t("partners.createPartner")}</PngPillButton>
            </form>
          </DialogContent>
        </Dialog>}
      </div>

      {/* Plain white pill search input — canonical pill-family chrome
          mirrored from the Tracking page so the partners listing reads
          as part of the same toolbar system. */}
      <div className="relative inline-flex items-center h-[28px] w-[180px] rounded-full bg-white border border-black/10">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
        <input
          type="text"
          placeholder={t("partners.searchPlaceholder", { defaultValue: "Search partners" })}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full h-full bg-transparent border-0 outline-none pl-8 pr-3 text-xs font-bold text-gray-800 placeholder:text-gray-500 rounded-full"
          data-testid="input-search-partner"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : partners && partners.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("name")}><div className="flex items-center gap-1.5">{t("nav.partner")} {sortIcon("name")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("contact")}><div className="flex items-center gap-1.5">{t("partners.contact", { defaultValue: "Contact" })} {sortIcon("contact")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("email")}><div className="flex items-center gap-1.5">{t("common.email")} {sortIcon("email")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("phone")}><div className="flex items-center gap-1.5">{t("common.phone")} {sortIcon("phone")}</div></TableHead>
                  <TableHead className="cursor-pointer select-none hover:bg-muted/50" onClick={() => handleSort("created")}><div className="flex items-center gap-1.5">{t("tickets.created")} {sortIcon("created")}</div></TableHead>
                  <TableHead className="w-16">{t("partners.posterColumn", { defaultValue: "Poster" })}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPartners!.filter((p) => {
                  const q = searchQuery.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    (p.name ?? "").toLowerCase().includes(q) ||
                    (p.contactName ?? "").toLowerCase().includes(q) ||
                    (p.contactEmail ?? "").toLowerCase().includes(q) ||
                    (p.contactPhone ?? "").toLowerCase().includes(q)
                  );
                }).map((p) => {
                  const primary = p.brandPrimaryColor || null;
                  const accent = p.brandAccentColor || null;
                  return (
                  <TableRow
                    key={p.id}
                    data-testid={`row-partner-${p.id}`}
                    style={primary ? { boxShadow: `inset 4px 0 0 0 ${primary}`, ["--row-brand-primary" as string]: primary } as React.CSSProperties : undefined}
                  >
                    <TableCell>
                      <Link href={`/partners/${p.id}`} className="font-medium text-gray-700 hover:text-[var(--row-brand-primary,var(--brand-primary))] transition-colors" data-testid={`link-partner-${p.id}`}>
                        <div className="flex items-center gap-2">
                          <PartnerRowLogo
                            logoUrl={p.logoUrl}
                            name={p.name}
                            partnerId={p.id}
                            altText={t("partners.logoAlt", { defaultValue: "{{name}} logo", name: p.name })}
                            fallbackColor={accentColor}
                          />
                          <span>{p.name}</span>
                          {(primary || accent) && (
                            <span
                              className="inline-flex items-center gap-1 ml-1"
                              data-testid={`brand-swatches-partner-${p.id}`}
                              aria-hidden="true"
                            >
                              {primary && (
                                <span
                                  className="inline-block w-3 h-3 rounded-sm border border-border"
                                  style={{ backgroundColor: primary }}
                                  data-testid={`swatch-primary-partner-${p.id}`}
                                />
                              )}
                              {accent && (
                                <span
                                  className="inline-block w-3 h-3 rounded-sm border border-border"
                                  style={{ backgroundColor: accent }}
                                  data-testid={`swatch-accent-partner-${p.id}`}
                                />
                              )}
                            </span>
                          )}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell>{p.contactName}</TableCell>
                    <TableCell>{p.contactEmail}</TableCell>
                    <TableCell>{p.contactPhone ? formatPhone(p.contactPhone) : "-"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <PosterThumbnail
                        partnerId={p.id}
                        partnerName={p.name}
                        primaryColor={p.brandPrimaryColor}
                        accentColor={p.brandAccentColor}
                        logoUrl={p.logoUrl}
                      />
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-12 text-center text-muted-foreground">
              <Handshake className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>{t("partners.empty", { defaultValue: "No partners yet. Add your first partner to get started." })}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
