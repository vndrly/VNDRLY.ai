import { createContext, useContext, type ReactNode } from "react";

const PortalBaseContext = createContext("/field");

export function PortalBaseProvider({
  base,
  children,
}: {
  base: string;
  children: ReactNode;
}) {
  return (
    <PortalBaseContext.Provider value={base.replace(/\/$/, "")}>
      {children}
    </PortalBaseContext.Provider>
  );
}

export function usePortalBase(): string {
  return useContext(PortalBaseContext);
}

export function isForemanPersona(user: {
  role?: string | null;
  vendorRole?: string | null;
} | null | undefined): boolean {
  return (
    user?.role === "field_employee" &&
    (user.vendorRole === "foreman" || user.vendorRole === "both")
  );
}
