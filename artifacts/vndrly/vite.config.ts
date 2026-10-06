import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { fetchEnergyTicker } from '../api-server/src/lib/market-data/energy-ticker';
import { renderPublicPrivacyHtml } from './src/lib/public-legal-html';

const rawPort = process.env.PORT;

const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), {
    name: 'public-privacy-document',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'legal/privacy/index.html', source: renderPublicPrivacyHtml() });
    },
  }, {
    name: 'local-market-ticker',
    apply: 'serve',
    configureServer(server) {
      // Explicit local-only provider configuration; the key never enters browser code.
      if (!process.env.MASSIVE_API_KEY_FILE && !process.env.MASSIVE_API_KEY) return;
      let key = process.env.MASSIVE_API_KEY;
      if (!key && process.env.MASSIVE_API_KEY_FILE) {
        const raw = fs.readFileSync(process.env.MASSIVE_API_KEY_FILE, 'utf8').trim();
        const values = parseEnv(raw);
        key = Object.entries(values).find(([name]) => /massive|polygon|api.?key/i.test(name))?.[1]
          ?? (/^[A-Za-z0-9_-]+$/.test(raw) ? raw : undefined);
      }
      server.middlewares.use('/api/market/ticker', async (req, res) => {
        if (req.method !== 'GET') { res.statusCode=405;res.end();return; }
        res.setHeader('Content-Type','application/json');
        res.setHeader('Cache-Control','no-store');
        try {res.end(JSON.stringify(await fetchEnergyTicker(key)));}
        catch {res.statusCode=503;res.end(JSON.stringify({error:'Market data unavailable'}));}
      });
    },
  }],
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
          if (id.includes("node_modules/mapbox-gl")) {
            return "mapbox-map";
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
