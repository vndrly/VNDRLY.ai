import { parseEnv } from 'node:util';

// Accept ordinary env assignments and the existing Supabase notes export.
// Legacy JWTs must match the URL's project and the expected service role.
export function parseLocalSecret(raw) {
  const env = parseEnv(raw);
  const url = raw.match(/https:\/\/([a-z0-9]+)\.supabase\.co\b/);
  if (url && !env.SUPABASE_URL) env.SUPABASE_URL = url[0];
  const project = env.SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/)?.[1];
  if (project && !env.SUPABASE_SERVICE_ROLE_KEY && !env.SUPABASE_SECRET_KEY) {
    for (const token of raw.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || []) {
      try {
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
        if (claims.ref === project && claims.role === 'service_role') {
          env.SUPABASE_SERVICE_ROLE_KEY = token;
          break;
        }
      } catch { /* Ignore malformed notes; never log secret text. */ }
    }
  }
  return env;
}
