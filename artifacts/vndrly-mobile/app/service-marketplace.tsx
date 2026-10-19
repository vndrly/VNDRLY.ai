import React, { useState } from "react";
import { ScrollView } from "react-native";
import { Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { useListWorkTypes } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/use-auth";
import TogglePillButton from "@/components/TogglePillButton";
import InPageHeader from "@/components/InPageHeader";
import VendorCapabilityEditor from "@/components/service-marketplace/VendorCapabilityEditor";
import PartnerVendorResults from "@/components/service-marketplace/PartnerVendorResults";
import JobOfferSheet from "@/components/service-marketplace/JobOfferSheet";
import { Label, Panel } from "@/components/service-marketplace/primitives";

function PartnerMarketplace({ partnerId }: { partnerId: number }) {
  const { t } = useTranslation();
  const catalog = useListWorkTypes();
  const [workTypeId, setWorkTypeId] = useState<number | null>(null);
  return (
    <Panel>
      <Label>{t("mobileMarketplace.partnerCatalog")}</Label>
      {catalog.isError && (
        <Label alert>{t("mobileMarketplace.unavailable")}</Label>
      )}
      {catalog.data?.map((item) => (
        <TogglePillButton key={item.id} onPress={() => setWorkTypeId(item.id)}>
          {item.name}
        </TogglePillButton>
      ))}
      {workTypeId && (
        <PartnerVendorResults
          key={workTypeId}
          partnerId={partnerId}
          workTypeId={workTypeId}
        />
      )}
    </Panel>
  );
}

export default function ServiceMarketplace() {
  const { t } = useTranslation();
  const { user } = useAuth();
  // Presentation routing only; every generated endpoint enforces current server membership.
  const vendorId = user?.role === "vendor" ? user.vendorId : null;
  const partnerId = user?.role === "partner" ? user.partnerId : null;
  const scope = `${user?.id}:${user?.activeMembershipId}:${user?.role}:${vendorId}:${partnerId}`;
  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, gap: 16 }}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ headerShown: false }} />
      <InPageHeader title={t("mobileMarketplace.title")} />
      {vendorId ? (
        <React.Fragment key={scope}>
          <VendorCapabilityEditor vendorId={vendorId} />
          <JobOfferSheet vendorId={vendorId} />
        </React.Fragment>
      ) : partnerId ? (
        <PartnerMarketplace key={scope} partnerId={partnerId} />
      ) : (
        <Label>{t("mobileMarketplace.noAccess")}</Label>
      )}
    </ScrollView>
  );
}
