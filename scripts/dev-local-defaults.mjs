import { applyLocalSessionSecret } from "./local-session-secret.mjs";

/** Defaults for local previews. Session signing is always isolated from production. */
process.env.NODE_ENV ??= "development";
process.env.PORT ??= "8080";
process.env.BASE_PATH ??= "/";
process.env.VITE_API_PROXY_TARGET ??= "http://localhost:8080";
process.env.EXPO_PUBLIC_DOMAIN ??= "https://vndrly.ai";
process.env.WORK_HUB_ENABLED ??= "1";
// Local previews may point at a shared database. Do not let a developer
// browser launch production-style Work Hub polling and projection scans.
process.env.WORK_HUB_BACKGROUND_WORKERS_ENABLED ??= "0";
applyLocalSessionSecret();
