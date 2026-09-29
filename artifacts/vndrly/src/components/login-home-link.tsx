import { useTranslation } from "react-i18next";
import SphereBackButton from "@/components/sphere-back-button";
import { brandStyleVars, DEFAULT_BRAND } from "@/hooks/use-brand";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";

/** A fixed homepage destination, independent of login history or org branding. */
export function LoginHomeLink() {
  const { t } = useTranslation();
  return (
    <a
      href={import.meta.env.BASE_URL}
      aria-label={t("login.learnMoreVndrly")}
      className="group inline-flex items-center gap-3 rounded-lg text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-400"
      style={brandStyleVars(DEFAULT_BRAND)}
      data-testid="login-home-link"
    >
      <SphereBackButton size={40} />
      <span className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <img src={VNDRLY_LOGO_SQUARE} alt="" className="h-8 w-8 rounded-md" draggable={false} />
          <span className="text-lg font-bold">VNDRLY</span>
        </span>
        <span className="text-[10px] text-gray-300 sm:text-xs">{t("login.learnMoreVndrly")}</span>
      </span>
    </a>
  );
}
