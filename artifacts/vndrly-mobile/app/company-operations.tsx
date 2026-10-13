import React from "react";
import ScreenSafeArea from "@/components/ScreenSafeArea";
import PortalPageHeader from "@/components/PortalPageHeader";
import CompanyOperationsChoice from "@/components/CompanyOperationsChoice";
export default function CompanyOperationsScreen() {
  return <ScreenSafeArea style={{ flex: 1 }}><PortalPageHeader title="Company operations" testIdPrefix="company-operations" /><CompanyOperationsChoice /></ScreenSafeArea>;
}
