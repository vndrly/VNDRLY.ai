import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";
import PageBackButton from "./page-back-button";
import SphereBackButton from "./sphere-back-button";
import "./mobile-page-header.css";

/** Put narrow-screen navigation in the page's existing heading row, not a second strip. */
export function MobilePageHeader({
  contentRef,
  fallbackTitle,
  sidebarOpen,
  onToggleMenu,
}: {
  contentRef: RefObject<HTMLElement | null>;
  fallbackTitle: string;
  sidebarOpen: boolean;
  onToggleMenu: () => void;
}) {
  const [location] = useLocation();
  const { t } = useTranslation();
  const [slot, setSlot] = useState<{
    host: HTMLElement;
    hasBack: boolean;
    title: string;
  } | null>(null);
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    const host = document.createElement("span");
    host.className = "portal-condensed-navigation";
    host.setAttribute("data-condensed-navigation", "");
    let hiddenHeading: HTMLElement | null = null;
    const sync = () => {
      const heading = [...content.querySelectorAll<HTMLElement>("h1")].find(
        (element) =>
          !element.closest(
            '[role="dialog"], [aria-modal="true"], [data-condensed-navigation]',
          ),
      );
      let row = heading?.parentElement ?? null;
      let back: HTMLElement | null = null;
      for (
        let level = 0;
        row && row !== content && level < 4;
        level++, row = row.parentElement
      ) {
        back =
          [
            ...row.querySelectorAll<HTMLElement>(
              '[data-page-back], [data-testid="button-back"]',
            ),
          ].find(
            (element) =>
              !host.contains(element) &&
              Boolean(
                element.compareDocumentPosition(heading!) &
                Node.DOCUMENT_POSITION_FOLLOWING,
              ),
          ) ?? null;
        if (back) break;
      }
      const target = back ?? heading;
      if (target?.parentElement) {
        if (
          host.parentElement !== target.parentElement ||
          host.nextElementSibling !== target
        )
          target.before(host);
      } else if (!host.isConnected) content.prepend(host);
      if (hiddenHeading && hiddenHeading !== heading)
        hiddenHeading.removeAttribute("data-condensed-source-title");
      hiddenHeading = !back && heading ? heading : null;
      hiddenHeading?.setAttribute("data-condensed-source-title", "");
      const title = heading?.textContent?.trim() || fallbackTitle;
      setSlot((previous) =>
        previous?.host === host &&
        previous.hasBack === !!back &&
        previous.title === title
          ? previous
          : { host, hasBack: !!back, title },
      );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(content, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      hiddenHeading?.removeAttribute("data-condensed-source-title");
      host.remove();
    };
  }, [contentRef, location, fallbackTitle]);
  useEffect(() => {
    slot?.host.classList.toggle("is-nav-open", sidebarOpen);
  }, [slot?.host, sidebarOpen]);
  if (!slot) return null;
  const menu = (
    <button
      type="button"
      className="group portal-condensed-menu"
      onClick={onToggleMenu}
      aria-label={t("nav.vndrlyMenu", { defaultValue: "VNDRLY Menu" })}
      aria-expanded={sidebarOpen}
      data-testid="button-phone-menu"
    >
      <SphereBackButton size={40} overlay={<Menu className="h-6 w-6" />} />
    </button>
  );
  return createPortal(
    slot.hasBack ? (
      menu
    ) : (
      <header
        className="portal-condensed-fallback"
        aria-label={t("common.pageNavigation", {
          defaultValue: "Page navigation",
        })}
      >
        {menu}
        <PageBackButton fallbackHref="/" testId="button-phone-back" />
        <h1>{slot.title}</h1>
      </header>
    ),
    slot.host,
  );
}
