import { createContext, useContext } from "react";

/** Actual mounted sidebar presence, rather than viewport size alone. */
export const SidebarNotificationsContext = createContext(false);
export const useSidebarNotifications = () => useContext(SidebarNotificationsContext);
