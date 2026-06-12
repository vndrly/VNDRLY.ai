import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "react-i18next";
import SphereBackButton from "@/components/sphere-back-button";
import { ShoppingCart } from "lucide-react";
import { CARD_TITLE_ICON_CLASS } from "@/components/ui/card";
import { useBrand } from "@/hooks/use-brand";
import { PartnerProductServiceCatalogCard } from "@/pages/partner-detail";

export default function PartnerCatalogPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const partnerId = user?.partnerId;
  const canManage =
    user?.role === "admin" ||
    (user?.availableMemberships ?? []).some(
      (m) =>
        m.orgType === "partner" &&
        m.orgId === partnerId &&
        m.role === "admin",
    );

  if (!partnerId) {
    return (
      <div className="p-6 text-muted-foreground">
        {t("partners.productServiceCatalog.partnerOnly")}
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-partner-catalog">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="group inline-flex items-center"
          aria-label="Back"
        >
          <SphereBackButton size={40} />
        </button>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShoppingCart className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
          {t("partners.productServiceCatalog.title")}
        </h1>
      </div>
      <PartnerProductServiceCatalogCard
        partnerId={partnerId}
        canManage={canManage}
        canAddToCatalog={canManage || user?.role === "admin"}
      />
    </div>
  );
}
