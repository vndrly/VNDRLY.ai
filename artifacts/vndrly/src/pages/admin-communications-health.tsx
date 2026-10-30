import { CardHeading } from "@/components/ui/card-heading";
import { ContentCardHeader } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { MailCheck, MessageSquareText, RefreshCcw, Smartphone } from "lucide-react";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";
import { useAuth } from "@/hooks/use-auth";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type HealthStatus = "ready" | "attention";
type HealthCheck = {
  key: string;
  label: string;
  ok: boolean;
  severity: "critical" | "warning" | "info";
  detail: string;
};
type ServiceHealth = {
  status: HealthStatus;
  configured: boolean;
  checks: HealthCheck[];
};
type CommunicationsHealthResponse = {
  generatedAt: string;
  overallStatus: HealthStatus;
  services: {
    sendgrid: ServiceHealth & {
      sandboxMode: boolean;
      domainAuthenticated: boolean;
    };
    twilio: ServiceHealth & {
      senderMode: "messaging_service" | "phone_number" | "missing";
      registrationStatus: string;
    };
    expoPush: ServiceHealth;
  };
  features: {
    passwordResetEmail: { ready: boolean; provider: "sendgrid" };
    transactionalSms: { ready: boolean; provider: "twilio" };
    pushNotifications: { ready: boolean; provider: "expo" };
  };
};

function statusVariant(status: HealthStatus): "default" | "destructive" {
  return status === "ready" ? "default" : "destructive";
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function CheckRow({ check }: { check: HealthCheck }) {
  return (
    <div className="flex items-start justify-between gap-3 border-t py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-sm font-medium">{check.label}</div>
        <div className="text-xs text-muted-foreground">{check.detail}</div>
      </div>
      <Badge variant={check.ok ? "default" : check.severity === "info" ? "secondary" : "destructive"}>
        {check.ok ? "OK" : check.severity}
      </Badge>
    </div>
  );
}

function ServiceCard({
  title,
  icon: Icon,
  service,
  children,
  testId,
}: {
  title: string;
  icon: typeof MailCheck;
  service: ServiceHealth;
  children?: React.ReactNode;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
            {title}
          </CardTitle>
          <Badge variant={statusVariant(service.status)}>
            {service.status}
          </Badge>
        </div>
        {children}
      </CardHeader>
      <CardContent>
        {service.checks.map((check) => (
          <CheckRow key={check.key} check={check} />
        ))}
      </CardContent>
    </Card>
  );
}

function FeaturePill({
  label,
  ready,
  provider,
  testId,
}: {
  label: string;
  ready: boolean;
  provider: string;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardHeading as="h3" className="text-sm font-medium">{label}</CardHeading>
            <div className="text-xs text-muted-foreground">{provider}</div>
          </div>
          <Badge variant={ready ? "default" : "destructive"}>
            {ready ? "Ready" : "Needs attention"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminCommunicationsHealth() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const { data, isLoading, isError, error, refetch, isFetching } =
    useQuery<CommunicationsHealthResponse>({
      queryKey: ["admin", "communications-health"],
      queryFn: async () => {
        const res = await fetch(`${API_BASE}/api/admin/communications-health`, {
          credentials: "include",
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "load_failed");
        }
        return res.json();
      },
      enabled: isAdmin,
    });

  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Admin role required.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-communications-health">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ContentPaneBackLink href="/" />
          <MailCheck className="w-6 h-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-communications-title">
              Communications Health
            </h1>
            <p className="text-sm text-muted-foreground">
              Read-only readiness for SendGrid email, Twilio SMS, password reset, and push notifications.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <Badge
              variant={statusVariant(data.overallStatus)}
              data-testid="badge-communications-overall"
            >
              {data.overallStatus}
            </Badge>
          )}
          <PillButton
            color="image"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh-communications-health"
          >
            <RefreshCcw className={`w-4 h-4 mr-1 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </PillButton>
        </div>
      </div>

      {isLoading && (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      )}

      {isError && (
        <Card>
        <ContentCardHeader title="Communications health" spanish="Estado de comunicaciones" />
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load communications health:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <FeaturePill
              label="Password reset email"
              provider="SendGrid"
              ready={data.features.passwordResetEmail.ready}
              testId="feature-password-reset-email"
            />
            <FeaturePill
              label="Transactional SMS"
              provider="Twilio"
              ready={data.features.transactionalSms.ready}
              testId="feature-transactional-sms"
            />
            <FeaturePill
              label="Push notifications"
              provider="Expo"
              ready={data.features.pushNotifications.ready}
              testId="feature-push-notifications"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ServiceCard
              title="SendGrid"
              icon={MailCheck}
              service={data.services.sendgrid}
              testId="card-communications-sendgrid"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant={data.services.sendgrid.sandboxMode ? "destructive" : "secondary"}>
                  {data.services.sendgrid.sandboxMode ? "sandbox on" : "live mode"}
                </Badge>
                <Badge variant={data.services.sendgrid.domainAuthenticated ? "default" : "destructive"}>
                  {data.services.sendgrid.domainAuthenticated ? "domain verified" : "domain pending"}
                </Badge>
              </div>
            </ServiceCard>

            <ServiceCard
              title="Twilio SMS"
              icon={MessageSquareText}
              service={data.services.twilio}
              testId="card-communications-twilio"
            >
              <div className="text-xs text-muted-foreground">
                Sender mode:{" "}
                <code className="rounded bg-muted px-1 py-0.5">
                  {data.services.twilio.senderMode}
                </code>
                <span className="mx-2">Registration:</span>
                <code className="rounded bg-muted px-1 py-0.5">
                  {data.services.twilio.registrationStatus}
                </code>
              </div>
            </ServiceCard>

            <ServiceCard
              title="Expo Push"
              icon={Smartphone}
              service={data.services.expoPush}
              testId="card-communications-push"
            />
          </div>

          <p className="text-xs text-muted-foreground">
            Last checked {formatGeneratedAt(data.generatedAt)}. This page reports configuration readiness only; use the communications smoke script for live provider API checks.
          </p>
        </>
      )}
    </div>
  );
}
