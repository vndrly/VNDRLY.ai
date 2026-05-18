import { useEffect, useState } from "react";
import {
  useVerifyEmployeeCompliance,
  getVerifyEmployeeComplianceQueryKey,
  type ComplianceVerifyResponse,
  type ComplianceCertSummary,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Camera,
} from "lucide-react";
import headerBg from "@assets/VNDRLY_Header_1776977091600.png";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type CertStatus = ComplianceCertSummary["status"];

function certBadge(status: CertStatus, expirationDate: string | null) {
  if (status === "expired") {
    return { label: "Expired", cls: "bg-red-100 text-red-700 border-red-200" };
  }
  if (status === "expiring") {
    if (expirationDate) {
      const days = Math.max(
        0,
        Math.ceil(
          (new Date(expirationDate + "T00:00:00").getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      return {
        label: `Expires in ${days}d`,
        cls: "bg-amber-100 text-amber-800 border-amber-200",
      };
    }
    return {
      label: "Expiring soon",
      cls: "bg-amber-100 text-amber-800 border-amber-200",
    };
  }
  if (status === "no_expiration") {
    return {
      label: "No expiration",
      cls: "bg-gray-100 text-gray-700 border-gray-200",
    };
  }
  return { label: "Valid", cls: "bg-green-100 text-green-700 border-green-200" };
}

type Banner = {
  level: "ok" | "warn" | "bad";
  title: string;
  detail: string;
};

function bannerFor(d: ComplianceVerifyResponse): Banner {
  if (!d.verified || !d.active) {
    return {
      level: "bad",
      title: "Not verified",
      detail: "This worker is not active in VNDRLY.",
    };
  }
  const expired = d.certifications.filter((c) => c.status === "expired").length;
  const expiring = d.certifications.filter((c) => c.status === "expiring").length;
  if (expired > 0) {
    return {
      level: "bad",
      title: "Expired credentials",
      detail: `${expired} certification${expired === 1 ? "" : "s"} expired.`,
    };
  }
  if (expiring > 0) {
    return {
      level: "warn",
      title: "Expiring soon",
      detail: `${expiring} certification${expiring === 1 ? "" : "s"} expiring within 60 days.`,
    };
  }
  return {
    level: "ok",
    title: "Verified",
    detail: "All credentials are current.",
  };
}

function BannerView({ banner }: { banner: Banner }) {
  const map = {
    ok: {
      bg: "bg-green-50 border-green-200 text-green-800",
      icon: <ShieldCheck className="w-7 h-7 text-green-600" />,
    },
    warn: {
      bg: "bg-amber-50 border-amber-200 text-amber-800",
      icon: <ShieldAlert className="w-7 h-7 text-amber-600" />,
    },
    bad: {
      bg: "bg-red-50 border-red-200 text-red-800",
      icon: <ShieldX className="w-7 h-7 text-red-600" />,
    },
  } as const;
  const cfg = map[banner.level];
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-4 ${cfg.bg}`}
      data-testid={`verify-banner-${banner.level}`}
    >
      {cfg.icon}
      <div className="min-w-0">
        <div className="font-semibold leading-tight">{banner.title}</div>
        <div className="text-sm opacity-90">{banner.detail}</div>
      </div>
    </div>
  );
}

export default function VerifyEmployeePage({ token }: { token: string }) {
  const { data, isLoading, error } = useVerifyEmployeeCompliance(token, {
    query: {
      queryKey: getVerifyEmployeeComplianceQueryKey(token),
      retry: false,
      refetchOnWindowFocus: false,
    },
  });
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => {
    setPhotoFailed(false);
  }, [data?.photoUrl]);

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-4 relative">
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-0"
        style={{
          backgroundImage: `url(${headerBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center top",
          opacity: 0.85,
          height: "200px",
          maskImage:
            "linear-gradient(to bottom, black 0%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 0%, transparent 100%)",
        }}
      />
      <div className="w-full max-w-md space-y-4 relative z-10">
        <div className="flex items-center justify-center gap-2 pt-2 text-amber-700 font-bold uppercase tracking-wider text-sm">
          <ShieldCheck className="w-4 h-4" /> VNDRLY Compliance
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="p-6 space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        ) : error || !data ? (
          <Card>
            <CardContent className="p-6 space-y-3 text-center">
              <ShieldX className="w-10 h-10 text-red-600 mx-auto" />
              <div className="font-semibold text-red-700" data-testid="verify-error">
                Invalid or expired verification link
              </div>
              <div className="text-sm text-muted-foreground">
                Ask the worker to display a fresh QR code from their VNDRLY
                compliance card.
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <BannerView banner={bannerFor(data)} />

            <Card>
              <CardContent className="p-6 space-y-4">
                <div className="flex gap-4 items-center">
                  {data.photoUrl && !photoFailed ? (
                    <img
                      src={
                        data.photoUrl.startsWith("http")
                          ? data.photoUrl
                          : `${API_BASE.replace(/\/+$/, "")}${data.photoUrl}`
                      }
                      onError={() => setPhotoFailed(true)}
                      alt=""
                      className="w-24 h-24 rounded-full object-cover border-2 border-gray-200"
                      data-testid="verify-photo"
                    />
                  ) : (
                    <div
                      className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center border-2 border-gray-200"
                      data-testid="verify-photo-placeholder"
                    >
                      <Camera className="w-8 h-8 text-gray-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div
                      className="font-bold text-xl leading-tight"
                      data-testid="verify-name"
                    >
                      {data.firstName} {data.lastName}
                    </div>
                    {data.jobTitle && (
                      <div className="text-sm text-muted-foreground">
                        {data.jobTitle}
                      </div>
                    )}
                    {data.employerName && (
                      <div
                        className="text-sm font-medium mt-0.5"
                        data-testid="verify-employer"
                      >
                        {data.employerName}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">
                      ID #{data.employeeId}
                    </div>
                  </div>
                </div>

                <div>
                  <div className="text-xs uppercase font-semibold text-muted-foreground mb-2">
                    Certifications
                  </div>
                  {data.certifications.length === 0 ? (
                    <div
                      className="text-sm text-muted-foreground"
                      data-testid="verify-no-certs"
                    >
                      No certifications recorded.
                    </div>
                  ) : (
                    <ul className="space-y-1.5" data-testid="verify-certs">
                      {data.certifications.map((c, i) => {
                        const b = certBadge(c.status, c.expirationDate);
                        return (
                          <li
                            key={`${c.name}-${i}`}
                            className="flex items-center justify-between gap-2 text-sm border rounded p-2"
                          >
                            <div className="min-w-0">
                              <div className="font-medium truncate">
                                {c.name}
                              </div>
                              <div className="text-xs text-muted-foreground truncate">
                                {c.issuer || "—"}
                                {c.expirationDate
                                  ? ` · exp ${c.expirationDate}`
                                  : ""}
                              </div>
                            </div>
                            <span
                              className={`shrink-0 text-xs font-semibold px-2 py-1 rounded border ${b.cls}`}
                            >
                              {b.label}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="text-[11px] text-muted-foreground text-center pt-2 border-t">
                  Verified {new Date(data.verifiedAt).toLocaleString()}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
