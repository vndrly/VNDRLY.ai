import { Redirect } from "wouter";
import { PublicLegalView } from "@/components/public-legal-view";
import { useAuth } from "@/hooks/use-auth";

export default function LegalPage() {
  const { user, isLoading } = useAuth();
  if (isLoading) return null;
  if (!user) {
    const prefix = window.location.pathname.startsWith("/es/") ? "/es" : "";
    return <Redirect to={prefix + "/legal/sms-enrollment-policy/"} replace />;
  }
  return <PublicLegalView kind="messaging" />;
}
