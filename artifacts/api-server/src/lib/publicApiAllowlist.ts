// Centralized allowlists for pre-auth API routes. Production runs a
// deny-by-default gate before route handlers; keep these patterns in
// sync when adding new public endpoints.

export type ApiAllowRule = { method: string; pattern: RegExp };

export const GUEST_ALLOWLIST: ApiAllowRule[] = [
  { method: "POST", pattern: /^\/api\/auth\/guest\/?$/ },
  { method: "GET", pattern: /^\/api\/auth\/guest\/me\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/guest\/logout\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/logout\/?$/ },
  // Allow staff auth endpoints so a stale visitor guest cookie doesn't
  // block a user from signing in to the vendor / staff portal.
  { method: "POST", pattern: /^\/api\/auth\/login\/?$/ },
  { method: "GET", pattern: /^\/api\/auth\/me\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/forgot-password\/?$/ },
  { method: "GET", pattern: /^\/api\/auth\/reset-password\/validate\/?$/ },
  { method: "POST", pattern: /^\/api\/auth\/reset-password\/?$/ },
  { method: "GET", pattern: /^\/api\/visits\/site-context\/[^/]+\/?$/ },
  {
    method: "GET",
    pattern: /^\/api\/visits\/sites\/\d+\/preferred-plate-states\/?$/,
  },
  { method: "GET", pattern: /^\/api\/visits\/public-sites\/?$/ },
  { method: "POST", pattern: /^\/api\/visits\/check-in\/?$/ },
  { method: "POST", pattern: /^\/api\/visits\/\d+\/check-out\/?$/ },
  { method: "GET", pattern: /^\/api\/visits\/me\/active\/?$/ },
  // Pre-auth brand fetch for mobile/web login surfaces.
  { method: "GET", pattern: /^\/api\/public\/platform-brand\/?$/ },
  { method: "GET", pattern: /^\/api\/public\/platform-eula\/?$/ },
  { method: "GET", pattern: /^\/api\/public\/login-brand\/?$/ },
];

const DEV_UNAUTHENTICATED_ALLOWLIST: ApiAllowRule[] =
  process.env.NODE_ENV === "development"
    ? [
        { method: "POST", pattern: /^\/api\/auth\/seed\/?$/ },
        { method: "POST", pattern: /^\/api\/auth\/seed-1099-fixture\/?$/ },
        {
          method: "POST",
          pattern: /^\/api\/auth\/seed-audit-pagination-fixture\/?$/,
        },
      ]
    : [];

export const PUBLIC_UNAUTHENTICATED_ALLOWLIST: ApiAllowRule[] = [
  { method: "GET", pattern: /^\/api\/work-hub\/file-library\/public\/[a-f0-9]{64}$/ },
  { method: "GET", pattern: /^\/api\/work-hub\/finance\/public\/[a-f0-9]{64}$/ },
  ...GUEST_ALLOWLIST,
  ...DEV_UNAUTHENTICATED_ALLOWLIST,
  { method: "GET", pattern: /^\/api\/healthz\/?$/ },
  { method: "GET", pattern: /^\/api\/health\/?$/ },
  { method: "POST", pattern: /^\/api\/onboarding\/partner\/?$/ },
  { method: "POST", pattern: /^\/api\/onboarding\/vendor\/?$/ },
  { method: "GET", pattern: /^\/api\/onboarding\/verify-email\/[^/]+\/?$/ },
  { method: "POST", pattern: /^\/api\/onboarding\/resend-verification\/?$/ },
  {
    method: "GET",
    pattern: /^\/api\/onboarding\/partner-contact\/by-token\/[^/]+\/?$/,
  },
  {
    method: "POST",
    pattern: /^\/api\/onboarding\/partner-contact\/by-token\/[^/]+\/accept\/?$/,
  },
  { method: "GET", pattern: /^\/api\/onboarding\/field\/by-token\/[^/]+\/?$/ },
  {
    method: "PUT",
    pattern: /^\/api\/onboarding\/field\/by-token\/[^/]+\/language\/?$/,
  },
  {
    method: "POST",
    pattern: /^\/api\/onboarding\/field\/by-token\/[^/]+\/upload-url\/?$/,
  },
  {
    method: "POST",
    pattern: /^\/api\/onboarding\/field\/by-token\/[^/]+\/upload-finalize\/?$/,
  },
  {
    method: "PUT",
    pattern: /^\/api\/onboarding\/field\/by-token\/[^/]+\/progress\/?$/,
  },
  {
    method: "POST",
    pattern: /^\/api\/onboarding\/field\/by-token\/[^/]+\/complete\/?$/,
  },
  { method: "POST", pattern: /^\/api\/onboarding\/refer\/?$/ },
  { method: "POST", pattern: /^\/api\/assistant\/signup\/[^/]+\/chat\/?$/ },
  { method: "GET", pattern: /^\/api\/storage\/public-objects\/.+$/ },
  // Public ACL uploads (logos) must load on the sign-in page after logout.
  { method: "GET", pattern: /^\/api\/storage\/objects\/.+$/ },
  { method: "PUT", pattern: /^\/api\/storage\/upload\/[^/]+\/?$/ },
];
