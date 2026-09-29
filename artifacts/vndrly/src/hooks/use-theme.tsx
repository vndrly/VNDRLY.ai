import { useEffect, type ReactNode } from "react";

const DARK_THEME = { mode: "dark", resolved: "dark" } as const;

/** The existing VNDRLY dark appearance is permanent on every route. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    try {
      window.localStorage.removeItem("vndrly:field:theme");
    } catch {
      // Restricted browsers may disable storage; appearance is still fixed.
    }
  }, []);
  return <>{children}</>;
}

export function useTheme() {
  return DARK_THEME;
}
