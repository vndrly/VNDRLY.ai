import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import NotificationsModal from "@/components/notifications-modal";

type NotificationsModalContextValue = {
  openNotifications: () => void;
  openNotificationsWithCategory: (category: string) => void;
};

const NotificationsModalContext = createContext<NotificationsModalContextValue | null>(null);

export function NotificationsModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [initialTab, setInitialTab] = useState("all");
  const value = useMemo(
    () => ({
      openNotifications: () => {
        setInitialTab("all");
        setOpen(true);
      },
      openNotificationsWithCategory: (category: string) => {
        setInitialTab(category);
        setOpen(true);
      },
    }),
    [],
  );

  return (
    <NotificationsModalContext.Provider value={value}>
      {children}
      <NotificationsModal open={open} onOpenChange={setOpen} initialTab={initialTab} />
    </NotificationsModalContext.Provider>
  );
}

export function useNotificationsModal() {
  const ctx = useContext(NotificationsModalContext);
  return ctx;
}
