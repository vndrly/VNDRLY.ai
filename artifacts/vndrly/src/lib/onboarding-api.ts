// Thin fetch wrappers for the onboarding endpoints. Centralized so
// every wizard step uses the same base URL convention and credential
// handling (cookies needed for the freshly-created session).

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export interface OnboardingProgressRow {
  id: number;
  orgType: "partner" | "vendor" | "field_employee";
  partnerId?: number | null;
  vendorId?: number | null;
  vendorPeopleId?: number | null;
  currentStep: string;
  completedSteps: string[];
  skippedSteps: string[];
  payload: Record<string, unknown>;
  startedAt: string;
  completedAt?: string | null;
  updatedAt: string;
}

export interface OnboardingStartResp {
  orgType: "partner" | "vendor" | "field_employee";
  orgId: number;
  userId: number;
  progress: OnboardingProgressRow;
}

async function ojson<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `${method} ${path} failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // body wasn't JSON — keep the generic message.
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export const onboardingApi = {
  startPartner: (body: { name: string; contactName: string; contactEmail: string; contactPhone: string; password: string }) =>
    ojson<OnboardingStartResp>("POST", "/api/onboarding/partner", body),

  startVendor: (body: { name: string; contactName: string; contactEmail: string; contactPhone: string; password: string }) =>
    ojson<OnboardingStartResp>("POST", "/api/onboarding/vendor", body),

  getProgress: (orgType: "partner" | "vendor", orgId: number) =>
    ojson<OnboardingProgressRow>("GET", `/api/onboarding/${orgType}/${orgId}/progress`),

  updateProgress: (
    orgType: "partner" | "vendor",
    orgId: number,
    body: { currentStep?: string; completedSteps?: string[]; skippedSteps?: string[]; payload?: Record<string, unknown> },
  ) => ojson<OnboardingProgressRow>("PUT", `/api/onboarding/${orgType}/${orgId}/progress`, body),

  complete: (orgType: "partner" | "vendor", orgId: number) =>
    ojson<OnboardingProgressRow>("POST", `/api/onboarding/${orgType}/${orgId}/complete`),

  getMine: () =>
    ojson<{
      progress: OnboardingProgressRow | null;
      user: { email: string | null; emailVerifiedAt: string | null } | null;
    }>("GET", "/api/onboarding/me"),

  resendVerification: () =>
    ojson<{ ok: true; sentTo?: string; alreadyVerified?: true }>(
      "POST",
      "/api/onboarding/resend-verification",
    ),

  getFieldByToken: (token: string) =>
    ojson<{
      vendorPeopleId: number;
      vendorId: number;
      vendorName: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
      photoUrl: string | null;
      preferredLanguage: "en" | "es" | null;
      progress: OnboardingProgressRow;
    }>("GET", `/api/onboarding/field/by-token/${encodeURIComponent(token)}`),

  updateFieldProgressByToken: (
    token: string,
    body: { currentStep?: string; completedSteps?: string[]; skippedSteps?: string[]; payload?: Record<string, unknown> },
  ) => ojson<OnboardingProgressRow>("PUT", `/api/onboarding/field/by-token/${encodeURIComponent(token)}/progress`, body),

  // Persist the English/Español toggle to vendor_people *before* the
  // invitee has a real session, so the token-mode assistant primes
  // in the right language from the very first turn.
  updateFieldLanguageByToken: (token: string, preferredLanguage: "en" | "es" | null) =>
    ojson<{ preferredLanguage: "en" | "es" | null }>(
      "PUT",
      `/api/onboarding/field/by-token/${encodeURIComponent(token)}/language`,
      { preferredLanguage },
    ),

  completeFieldByToken: (
    token: string,
    body: {
      firstName: string;
      lastName: string;
      phone?: string | null;
      photoUrl?: string | null;
      password: string;
      preferredLanguage?: "en" | "es" | null;
      pecCertification?: boolean | null;
      pecExpirationDate?: string | null;
      vendorRole: "field" | "foreman" | "office" | "both";
    },
  ) => ojson<OnboardingStartResp>("POST", `/api/onboarding/field/by-token/${encodeURIComponent(token)}/complete`, body),

  createFieldInvite: (employeeId: number) =>
    ojson<{ employeeId: number; token: string; url: string; emailSent: boolean }>(
      "POST",
      `/api/field-employees/${employeeId}/onboarding-invite`,
    ),

  // The work-types catalog used by the vendor onboarding "Work Types"
  // step. Server requires a valid session, which the just-signed-up
  // vendor admin already has via the cookie set by /onboarding/vendor.
  getWorkTypes: () =>
    ojson<Array<{ id: number; name: string; category: string | null }>>("GET", "/api/work-types"),

  // Email a friend a public /signup link to start their own org's
  // onboarding (vendor or partner). Any logged-in user may invoke.
  referToVndrly: (email: string) =>
    ojson<{ ok: true; sentTo: string }>("POST", "/api/onboarding/refer", { email }),
};
