import { useEffect } from "react";
import { useNotificationsModal } from "@/components/notifications-modal-context";

/** Legacy /notifications route — opens the global branded modal instead of a full page. */
export default function NotificationsInboxPage() {
  const notificationsModal = useNotificationsModal();

  useEffect(() => {
    notificationsModal?.openNotifications();
    if (window.history.length > 1) {
      window.history.back();
    }
  }, [notificationsModal]);

  return null;
}
