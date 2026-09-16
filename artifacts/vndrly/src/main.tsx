import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import "./lib/i18n";
import { installInAppNavigationTracking } from "./lib/in-app-navigation";

installInAppNavigationTracking();

createRoot(document.getElementById("root")!).render(<App />);
