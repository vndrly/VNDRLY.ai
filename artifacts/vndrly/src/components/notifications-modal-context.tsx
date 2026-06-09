import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import NotificationsModal from "@/components/notifications-modal";

type NotificationsModalContextValue = {
  openNotifications: () => void;
};

const NotificationsModalContext = createContext<NotificationsModalContextValue | null>(null);

export function NotificationsModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(
    () => ({
      openNotifications: () => setOpen(true),
    }),
    [],
  );

  return (
    <NotificationsModalContext.Provider value={value}>
      {children}
      <NotificationsModal open={open} onOpenChange={setOpen} />
    </NotificationsModalContext.Provider>
  );
}

export function useNotificationsModal() {
  const ctx = useContext(NotificationsModalContext);
  return ctx;
}
