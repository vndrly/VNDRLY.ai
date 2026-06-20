import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT;

const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/leaflet") || id.includes("node_modules/react-leaflet")) {
            return "vendor-leaflet";
          }
          if (id.includes("node_modules/recharts")) {
            return "vendor-recharts";
          }
          if (id.includes("node_modules/jspdf") || id.includes("node_modules/svg2pdf")) {
            return "vendor-pdf";
          }
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Optional dev-only proxy for /api so end-to-end tests (which hit the
    // vite dev server directly) can reach the api-server. No effect when
    // VITE_API_PROXY_TARGET is unset.
    ...(process.env.VITE_API_PROXY_TARGET
      ? {
          proxy: {
            "/api": {
              target: process.env.VITE_API_PROXY_TARGET,
              changeOrigin: true,
            },
          },
        }
      : {}),
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    ...(process.env.VITE_API_PROXY_TARGET
      ? {
          proxy: {
            "/api": {
              target: process.env.VITE_API_PROXY_TARGET,
              changeOrigin: true,
            },
          },
        }
      : {}),
  },
});
