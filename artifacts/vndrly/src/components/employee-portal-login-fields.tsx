import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Smartphone } from "lucide-react";
import {
  useGetFieldEmployeeLogin,
  useSetFieldEmployeeLogin,
  useDeleteFieldEmployeeLogin,
  useCreateFieldOnboardingInvite,
  getGetFieldEmployeeLoginQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PngPillButton as PillButton, PngPillButton } from "@/components/png-pill-rollover";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

export type EmployeePortalLoginFieldsProps = {
  employeeId: number;
  /** Profile email used when no login exists yet. */
  defaultEmail?: string;
  vendorRole?: string | null;
  /** Full page card vs compact block for edit modals. */
  variant?: "card" | "inline";
  showOnboardingInvite?: boolean;
  showDisableLogin?: boolean;
  testIdPrefix?: string;
  onSaved?: () => void;
};

export default function EmployeePortalLoginFields({
  employeeId,
  defaultEmail = "",
  vendorRole,
  variant = "inline",
  showOnboardingInvite = false,
  showDisableLogin = false,
  testIdPrefix = "employee-login",
  onSaved,
}: EmployeePortalLoginFieldsProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: loginInfo } = useGetFieldEmployeeLogin(employeeId, {
    query: { enabled: !!employeeId, queryKey: getGetFieldEmployeeLoginQueryKey(employeeId) },
  });
  const setLoginMutation = useSetFieldEmployeeLogin();
  const deleteLoginMutation = useDeleteFieldEmployeeLogin();
  const onboardingInviteMutation = useCreateFieldOnboardingInvite();

  const [portalLoginEnabled, setPortalLoginEnabled] = useState(false);
  const [credEmail, setCredEmail] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [credLanguage, setCredLanguage] = useState<"browser" | "en" | "es">("browser");
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const credBusy =
    setLoginMutation.isPending || deleteLoginMutation.isPending || onboardingInviteMutation.isPending;

  useEffect(() => {
    if (loginInfo?.email) setCredEmail(loginInfo.email);
    else if (defaultEmail) setCredEmail(defaultEmail);
  }, [loginInfo?.email, defaultEmail]);

  useEffect(() => {
    const enabled = !!(loginInfo?.hasLogin || loginInfo?.portalLoginEnabled);
    setPortalLoginEnabled(enabled);
    if (loginInfo?.hasLogin) {
      setMustChangePassword(!!loginInfo.mustChangePassword);
    } else if (enabled) {
      setMustChangePassword(true);
    } else {
      setMustChangePassword(false);
    }
  }, [loginInfo?.hasLogin, loginInfo?.portalLoginEnabled, loginInfo?.mustChangePassword, employeeId]);

  const invalidateLogin = () => {
    queryClient.invalidateQueries({ queryKey: getGetFieldEmployeeLoginQueryKey(employeeId) });
    onSaved?.();
  };

  const portalPath =
    vendorRole === "admin" || vendorRole === "office"
      ? "/"
      : vendorRole === "foreman" || vendorRole === "both"
        ? "/foreman"
        : "/field";

  const saveCredentials = async () => {
    if (!portalLoginEnabled) {
      try {
        await deleteLoginMutation.mutateAsync({ id: employeeId });
        toast({ title: t("fieldEmployeeDetail.loginDisabled") });
        setCredPassword("");
        invalidateLogin();
      } catch (err: unknown) {
        toast({
          title: translateApiError(err, t, t("fieldEmployeeDetail.failedToDisableLogin")),
          variant: "destructive",
        });
      }
      return;
    }

    if (!credEmail.trim()) {
      toast({ title: t("fieldEmployeeDetail.emailPasswordRequired"), variant: "destructive" });
      return;
    }

    const creating = !loginInfo?.hasLogin;
    if (creating && credPassword.length < 8) {
      toast({ title: t("fieldEmployeeDetail.emailPasswordRequired"), variant: "destructive" });
      return;
    }
    if (!creating && credPassword.length > 0 && credPassword.length < 8) {
      toast({ title: t("fieldEmployeeDetail.emailPasswordRequired"), variant: "destructive" });
      return;
    }

    try {
      await setLoginMutation.mutateAsync({
        id: employeeId,
        data: {
          email: credEmail.trim(),
          portalLoginEnabled: true,
          mustChangePassword,
          ...(credPassword ? { password: credPassword } : {}),
          ...(credLanguage === "browser" ? {} : { preferredLanguage: credLanguage }),
        },
      });
      toast({
        title: loginInfo?.hasLogin
          ? t("fieldEmployeeDetail.credentialsUpdated")
          : t("fieldEmployeeDetail.loginCreated"),
      });
      setCredPassword("");
      invalidateLogin();
    } catch (err: unknown) {
      toast({
        title: translateApiError(err, t, t("fieldEmployeeDetail.failedToSaveCredentials")),
        variant: "destructive",
      });
    }
  };

  const disableCredentials = async () => {
    if (!confirm(t("fieldEmployeeDetail.disableLoginConfirm"))) return;
    try {
      await deleteLoginMutation.mutateAsync({ id: employeeId });
      toast({ title: t("fieldEmployeeDetail.loginDisabled") });
      setCredPassword("");
      setPortalLoginEnabled(false);
      invalidateLogin();
    } catch (err: unknown) {
      toast({
        title: translateApiError(err, t, t("fieldEmployeeDetail.failedToDisableLogin")),
        variant: "destructive",
      });
    }
  };

  const body = (
    <div className="space-y-4">
      {portalLoginEnabled && loginInfo?.hasLogin ? (
        <div className="rounded-md border-2 border-green-200 bg-green-50 p-3 flex items-start gap-2">
          <Smartphone className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
          <div className="flex-1 text-xs">
            <p className="font-semibold text-green-800">{t("fieldEmployeeDetail.activeLogin")}</p>
            <p className="text-green-700 mt-0.5">
              {t("fieldEmployeeDetail.signsInAt")}{" "}
              <code className="font-mono">
                {BASE_PATH || ""}
                {portalPath}
              </code>{" "}
              {t("fieldEmployeeDetail.asUser")}{" "}
              <span className="font-semibold">{loginInfo.email}</span>
            </p>
          </div>
        </div>
      ) : portalLoginEnabled && !loginInfo?.hasLogin ? (
        <div className="rounded-md border-2 border-amber-200 bg-amber-50 p-3 flex items-start gap-2">
          <Smartphone className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
          <div className="flex-1 text-xs">
            <p className="font-semibold text-amber-800">{t("fieldEmployeeDetail.noLoginYet")}</p>
            <p className="text-amber-700 mt-0.5">{t("fieldEmployeeDetail.noLoginYetDesc")}</p>
          </div>
        </div>
      ) : null}

      <div className="flex items-start gap-2">
        <Checkbox
          id={`${testIdPrefix}-portal-enabled`}
          checked={portalLoginEnabled}
          onCheckedChange={(v) => setPortalLoginEnabled(!!v)}
          data-testid={`${testIdPrefix}-portal-enabled`}
        />
        <Label htmlFor={`${testIdPrefix}-portal-enabled`} className="cursor-pointer text-sm leading-snug">
          {t("fieldEmployeeDetail.enablePortalLogin")}
          <span className="block text-xs text-muted-foreground font-normal mt-0.5">
            {t("fieldEmployeeDetail.enablePortalLoginHelp", { path: portalPath })}
          </span>
        </Label>
      </div>

      {portalLoginEnabled ? (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${testIdPrefix}-email`}>{t("fieldEmployeeDetail.loginEmail")}</Label>
              <Input
                id={`${testIdPrefix}-email`}
                type="email"
                value={credEmail}
                onChange={(e) => setCredEmail(e.target.value)}
                placeholder={t("fieldEmployeeDetail.loginEmailPlaceholder")}
                data-testid={`${testIdPrefix}-email`}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${testIdPrefix}-password`}>
                {loginInfo?.hasLogin
                  ? t("fieldEmployeeDetail.newPassword")
                  : t("fieldEmployeeDetail.password")}
              </Label>
              <Input
                id={`${testIdPrefix}-password`}
                type="password"
                value={credPassword}
                onChange={(e) => setCredPassword(e.target.value)}
                placeholder={
                  loginInfo?.hasLogin
                    ? t("fieldEmployeeDetail.passwordOptionalPlaceholder")
                    : t("fieldEmployeeDetail.passwordPlaceholder")
                }
                autoComplete="new-password"
                data-testid={`${testIdPrefix}-password`}
              />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id={`${testIdPrefix}-must-change-password`}
              checked={mustChangePassword}
              onCheckedChange={(v) => setMustChangePassword(!!v)}
              data-testid={`${testIdPrefix}-must-change-password`}
            />
            <Label htmlFor={`${testIdPrefix}-must-change-password`} className="cursor-pointer text-sm leading-snug">
              {t("fieldEmployeeDetail.forcePasswordChange")}
              <span className="block text-xs text-muted-foreground font-normal mt-0.5">
                {t("fieldEmployeeDetail.forcePasswordChangeHelp")}
              </span>
            </Label>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${testIdPrefix}-language`}>{t("fieldEmployeeDetail.defaultLanguage")}</Label>
            <Select value={credLanguage} onValueChange={(v) => setCredLanguage(v as "browser" | "en" | "es")}>
              <SelectTrigger id={`${testIdPrefix}-language`} data-testid={`${testIdPrefix}-language`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="browser">{t("fieldEmployeeDetail.useBrowserLanguage")}</SelectItem>
                <SelectItem value="en">{t("fieldEmployeeDetail.english")}</SelectItem>
                <SelectItem value="es">{t("fieldEmployeeDetail.spanish")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("fieldEmployeeDetail.defaultLanguageHelp")}</p>
          </div>
        </>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <PngPillButton
          type="button"
          color="blue"
          onClick={saveCredentials}
          disabled={credBusy}
          data-testid={`${testIdPrefix}-save`}
        >
          {credBusy
            ? t("fieldEmployeeDetail.saving")
            : portalLoginEnabled
              ? loginInfo?.hasLogin
                ? t("fieldEmployeeDetail.updatePassword")
                : t("fieldEmployeeDetail.createLogin")
              : t("fieldEmployeeDetail.saveLoginSettings")}
        </PngPillButton>
        {showOnboardingInvite && portalLoginEnabled && !loginInfo?.hasLogin && (
          <PillButton
            type="button"
            color="image"
            disabled={credBusy}
            onClick={async () => {
              try {
                const data = await onboardingInviteMutation.mutateAsync({ id: employeeId });
                await navigator.clipboard.writeText(data.url).catch(() => undefined);
                toast({
                  title: data.emailSent
                    ? "Invite emailed and link copied to clipboard."
                    : "Invite link copied to clipboard.",
                });
              } catch (err) {
                toast({
                  title: translateApiError(err, t, "Could not create invite link."),
                  variant: "destructive",
                });
              }
            }}
            data-testid={`${testIdPrefix}-onboarding-invite`}
          >
            Send onboarding invite
          </PillButton>
        )}
        {showDisableLogin && loginInfo?.hasLogin && (
          <PngPillButton
            type="button"
            color="red"
            onClick={disableCredentials}
            disabled={credBusy}
            data-testid={`${testIdPrefix}-disable`}
          >
            {t("fieldEmployeeDetail.disableLogin")}
          </PngPillButton>
        )}
      </div>
    </div>
  );

  if (variant === "card") {
    return (
      <Card data-testid={`${testIdPrefix}-section`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-amber-500" />
            {t("fieldEmployeeDetail.fieldPortalLogin")}
          </CardTitle>
        </CardHeader>
        <CardContent>{body}</CardContent>
      </Card>
    );
  }

  return (
    <div className="rounded-md border p-3 space-y-1" data-testid={`${testIdPrefix}-section`}>
      <p className="text-sm font-semibold flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-amber-500" />
        {t("fieldEmployeeDetail.fieldPortalLogin")}
      </p>
      {body}
    </div>
  );
}
