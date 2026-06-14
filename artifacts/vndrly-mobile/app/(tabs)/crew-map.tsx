import { useAuth } from "@/hooks/use-auth";
import ForemanCrewMapScreen from "@/components/ForemanCrewMapScreen";
import PartnerSiteCrewMapScreen from "@/components/PartnerSiteCrewMapScreen";
import {
  isAdminOfficeUser,
  isPartnerOfficeUser,
} from "@/lib/mobile-viewer";

export default function CrewMapTab() {
  const { user } = useAuth();
  if (isPartnerOfficeUser(user) || isAdminOfficeUser(user)) {
    return <PartnerSiteCrewMapScreen />;
  }
  return <ForemanCrewMapScreen />;
}
