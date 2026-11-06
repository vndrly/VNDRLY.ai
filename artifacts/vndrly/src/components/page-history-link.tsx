import { Link, useLocation } from "wouter";
import type { ComponentProps } from "react";
import { navigateBackInApp } from "@/lib/in-app-navigation";

export default function PageHistoryLink({ href, onClick, ...props }: ComponentProps<typeof Link> & { href: string }) {
  const [, navigate] = useLocation();
  return (
    <Link
      {...props}
      href={href}
      data-page-back
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigateBackInApp(navigate, href);
      }}
    />
  );
}
