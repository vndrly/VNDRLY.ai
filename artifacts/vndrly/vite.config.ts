import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import fs from 'node:fs';
import { parseEnv } from 'node:util';
import { fetchEnergyTicker } from '../api-server/src/lib/market-data/energy-ticker';
import { renderPublicPrivacyHtml, renderPublicTermsHtml, renderPublicMessagingHtml, renderPublicSmsPolicyHtml } from './src/lib/public-legal-html';

const rawPort = process.env.PORT;

const port = rawPort ? Number(rawPort) : 5173;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";
const legalImages = new Map([
  ['back-sphere.png', 'VNDRLYai-Button-blank_1777361718577.png'],
  ['back-gloss.png', 'download_1777663665476.png'],
  ['back-arrow.png', 'Symbol_Arrow_Left_1777371273492.png'],
]);
const readLegalImage = (source: string) => fs.readFileSync(path.resolve(import.meta.dirname, '../../attached_assets', source));

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss(), {
    name: 'public-privacy-document',
    configureServer(server) {
      server.middlewares.use('/legal-assets', (req, res, next) => {
        const source = legalImages.get((req.url ?? '').split('?')[0].slice(1));
        if (!source || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
        res.setHeader('Content-Type', 'image/png');
        res.end(readLegalImage(source));
      });
    },
    generateBundle: { order: 'post', handler(_options, bundle) {
      const entry = bundle['index.html'];
      if (entry?.type !== 'asset' || typeof entry.source !== 'string') throw new Error('Missing VNDRLY web entry');
      const appAssets = entry.source.match(/<script\b[^>]*type="module"[^>]*src="[^"]+"[^>]*><\/script>|<link\b[^>]*rel="(?:stylesheet|modulepreload)"[^>]*>/g) ?? [];
      if (!appAssets.some((tag) => tag.startsWith('<script'))) throw new Error('Missing public legal page app module');
      // Keep the public consent document available before the app loads and
      // without JavaScript. The regular app replaces it with the branded view.
      const appDocument = (html: string) => html
        .replace('</head>', `${appAssets.join('\n')}</head>`)
        .replace('<body>', '<body><div id="root">')
        .replace('</body>', '</div></body>');
      this.emitFile({ type: 'asset', fileName: 'legal/privacy/index.html', source: appDocument(renderPublicPrivacyHtml()) });
      this.emitFile({ type: 'asset', fileName: 'legal/terms/index.html', source: appDocument(renderPublicTermsHtml()) });
      this.emitFile({ type: 'asset', fileName: 'legal/messaging/index.html', source: appDocument(renderPublicMessagingHtml('en')) });
      this.emitFile({ type: 'asset', fileName: 'sms/index.html', source: appDocument(renderPublicMessagingHtml('en')) });
      this.emitFile({ type: 'asset', fileName: 'es/sms/index.html', source: appDocument(renderPublicMessagingHtml('es')) });
      this.emitFile({ type: 'asset', fileName: 'es/legal/privacy/index.html', source: appDocument(renderPublicPrivacyHtml('es')) });
      this.emitFile({ type: 'asset', fileName: 'es/legal/terms/index.html', source: appDocument(renderPublicTermsHtml('es')) });
      this.emitFile({ type: 'asset', fileName: 'es/legal/messaging/index.html', source: appDocument(renderPublicMessagingHtml('es')) });
      this.emitFile({ type: 'asset', fileName: 'legal/sms-enrollment-policy/index.html', source: appDocument(renderPublicSmsPolicyHtml()) });
      this.emitFile({ type: 'asset', fileName: 'es/legal/sms-enrollment-policy/index.html', source: appDocument(renderPublicSmsPolicyHtml('es')) });
      for (const [fileName, sourceName] of legalImages) {
        this.emitFile({ type: 'asset', fileName: `legal-assets/${fileName}`, source: readLegalImage(sourceName) });
      }
    } },
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
            ...(process.env.VITE_COVERAGE_API_PROXY_TARGET ? {
                "/api/storage/upload/": {
                  target: process.env.VITE_COVERAGE_API_PROXY_TARGET,
                  changeOrigin: true,
                },
                "^/api/work-hub/(?:channels|file-library)(?:/|\\?|$)": {
                  target: process.env.VITE_COVERAGE_API_PROXY_TARGET,
                  changeOrigin: true,
                },
              "/api/native-operations/pickup-shifts": {
                target: process.env.VITE_COVERAGE_API_PROXY_TARGET,
                changeOrigin: true,
              },
              "/api/work-hub/site-shift-plans": {
                target: process.env.VITE_COVERAGE_API_PROXY_TARGET,
                changeOrigin: true,
              },
            } : {}),
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
