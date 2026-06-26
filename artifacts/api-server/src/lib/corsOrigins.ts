const allowedOrigins = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:8081",
  "http://localhost:8082",
  "http://127.0.0.1:8081",
  "http://127.0.0.1:8082",
  "http://localhost:1420",
  "https://tauri.localhost",
  "http://tauri.localhost",
  "https://asset.localhost",
  "http://asset.localhost",
  "https://ipc.localhost",
  "http://ipc.localhost",
  "https://vndrly.ai",
  "https://www.vndrly.ai",
];

export function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  // Tauri 2 desktop webview (Windows/macOS/Linux packaged builds).
  if (/^https?:\/\/(tauri|asset|ipc)\.localhost(:\d+)?$/i.test(origin)) {
    return true;
  }
  if (/^tauri:\/\/localhost/i.test(origin)) return true;
  return false;
}
