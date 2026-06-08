import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import {
  useGetFieldEmployeeLogin,
  useSetFieldEmployeeLogin,
  useDeleteFieldEmployeeLogin,
  getGetFieldEmployeeLoginQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

export type EmployeePortalLoginFieldsProps = {
  employeeId: number;
  defaultEmail?: string;
  vendorRole?: string | null;
  variant?: "card" | "inline";
  testIdPrefix?: string;
  onSaved?: () => void;
};

export default function EmployeePortalLoginFields({
  employeeId,
  defaultEmail = "",
  vendorRole,
  variant = "inline",
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

  const [portalLoginEnabled, setPortalLoginEnabled] = useState(false);
  const [credEmail, setCredEmail] = useState("");
  const [credPassword, setCredPassword] = useState("");
  const [mustChangePassword, setMustChangePassword] = useState(false);

  const credBusy = setLoginMutation.isPending || deleteLoginMutation.isPending;

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

  const portalPath =
    vendorRole === "admin" || vendorRole === "office"
      ? "/"
      : vendorRole === "foreman" || vendorRole === "both"
        ? "/foreman"
        : "/field";

  const body = (
    <div className="space-y-4">
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
        </>
      ) : null}

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
