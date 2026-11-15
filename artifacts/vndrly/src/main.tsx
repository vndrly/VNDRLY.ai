import { prepareGateDashboardSession } from "./lib/gate-dashboard-session";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./components/branded-modal.css";
import "./lib/i18n";
import { installInAppNavigationTracking } from "./lib/in-app-navigation";

installInAppNavigationTracking();

void prepareGateDashboardSession().then(() => createRoot(document.getElementById("root")!).render(<App />));
