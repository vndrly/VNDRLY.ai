import { useEffect, useState, type RefObject } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Menu } from "lucide-react";
import PageBackButton from "./page-back-button";
import SphereBackButton from "./sphere-back-button";
import "./mobile-page-header.css";

/** Read the page's actual title so detail names and translated headings stay intact.
 * Only the phone stylesheet replaces the original heading; desktop keeps its layout. */
export function MobilePageHeader({ contentRef, fallbackTitle, sidebarOpen, onToggleMenu }: {
  contentRef: RefObject<HTMLElement | null>;
  fallbackTitle: string;
  sidebarOpen: boolean;
  onToggleMenu: () => void;
}) {
  const [location] = useLocation();
  const { t } = useTranslation();
  const [page, setPage] = useState({title:fallbackTitle, fallback:"/"});
  useEffect(() => {
    const content=contentRef.current;
    if(!content)return;
    let marked:HTMLElement[]=[];
    const clear=()=>{for(const element of marked){element.removeAttribute("data-mobile-source-title");element.removeAttribute("data-mobile-source-control");element.removeAttribute("data-mobile-source-empty");}marked=[];};
    const sync=()=>{
      const heading=[...content.querySelectorAll<HTMLElement>("h1")].find(element=>!element.closest('[role="dialog"], [aria-modal="true"]'));
      clear();
      if(!heading){setPage(previous=>previous.title===fallbackTitle&&previous.fallback==="/"?previous:{title:fallbackTitle,fallback:"/"});return;}
      heading.setAttribute("data-mobile-source-title","");marked.push(heading);
      let row=heading.parentElement,back:HTMLElement|null=null;
      for(let level=0;row&&row!==content&&level<4;level++,row=row.parentElement){
        back=[...row.querySelectorAll<HTMLElement>('[data-page-back],[data-testid="button-back"]')].find(element=>Boolean(element.compareDocumentPosition(heading)&Node.DOCUMENT_POSITION_FOLLOWING))??null;
        if(back)break;
      }
      if(back&&row&&row!==content){
        back.setAttribute("data-mobile-source-control","");marked.push(back);
        for(const icon of row.querySelectorAll<HTMLElement>(":scope > svg")){icon.setAttribute("data-mobile-source-control","");marked.push(icon);}
        const remaining=row.cloneNode(true) as HTMLElement;
        remaining.querySelectorAll('[data-mobile-source-title],[data-mobile-source-control]').forEach(element=>element.remove());
        if(!remaining.textContent?.trim()&&!remaining.querySelector('button,a,input,select,textarea,img')){row.setAttribute("data-mobile-source-empty","");marked.push(row);}
      }
      const next={title:heading.textContent?.trim()||fallbackTitle,fallback:back?.getAttribute("href")||"/"};
      setPage(previous=>previous.title===next.title&&previous.fallback===next.fallback?previous:next);
    };
    sync();
    const observer=new MutationObserver(sync);observer.observe(content,{childList:true,characterData:true,subtree:true});
    return()=>{observer.disconnect();clear();};
  },[contentRef,location,fallbackTitle]);
  return <header className={`portal-phone-header${sidebarOpen?" is-nav-open":""}`} aria-label={t("common.pageNavigation",{defaultValue:"Page navigation"})}>
    <PageBackButton fallbackHref={page.fallback} testId="button-phone-back" ariaLabel={t("common.back",{defaultValue:"Back"})}/>
    <button type="button" className="group portal-phone-menu" onClick={onToggleMenu} aria-label={t("nav.toggleMenu",{defaultValue:"Toggle navigation"})} aria-expanded={sidebarOpen} data-testid="button-phone-menu">
      <SphereBackButton size={40} overlay={<Menu className="h-6 w-6"/>}/>
    </button>
    <h1>{page.title}</h1>
  </header>;
}
