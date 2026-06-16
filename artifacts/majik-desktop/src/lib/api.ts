import type { MajikCircleSnapshot } from "@workspace/majik";

const API_BASE =
  import.meta.env.VITE_VNDRLY_API_URL?.replace(/\/$/, "") ||
  "http://localhost:8080";

const SESSION_KEY = "majik.session";

export function getApiBase(): string {
  return API_BASE;
}

export async function loadStoredSession(): Promise<string | null> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("majik-store.json", { autoSave: false, defaults: {} });
    const value = await store.get<string>(SESSION_KEY);
    return value ?? null;
  } catch {
    return localStorage.getItem(SESSION_KEY);
  }
}

export async function saveStoredSession(cookie: string | null): Promise<void> {
  try {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load("majik-store.json", { autoSave: true, defaults: {} });
    if (cookie) await store.set(SESSION_KEY, cookie);
    else await store.delete(SESSION_KEY);
  } catch {
    if (cookie) localStorage.setItem(SESSION_KEY, cookie);
    else localStorage.removeItem(SESSION_KEY);
  }
}

function extractSessionCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  const match = setCookie.match(/vndrly_session=([^;]+)/);
  return match ? `vndrly_session=${match[1]}` : null;
}

function sessionFromToken(token: string): string {
  return `vndrly_session=${token}`;
}

function bearerFromSession(sessionCookie: string): string | null {
  const match = sessionCookie.match(/^vndrly_session=(.+)$/);
  return match ? match[1] : null;
}

async function apiFetch(
  path: string,
  init: RequestInit = {},
  sessionCookie: string | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (sessionCookie) {
    headers.set("Cookie", sessionCookie);
    const bearer = bearerFromSession(sessionCookie);
    if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  }
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
}

export async function login(
  username: string,
  password: string,
): Promise<{ cookie: string; displayName: string | null; userId: number }> {
  const res = await apiFetch(
    "/auth/login",
    {
      method: "POST",
      body: JSON.stringify({ username, password }),
    },
    null,
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || "Login failed");
  }
  // Mobile/native clients can't read Set-Cookie cross-origin; API returns
  // the signed session token in JSON (see POST /api/auth/login).
  const token = typeof body.token === "string" ? body.token : null;
  const cookie =
    token != null
      ? sessionFromToken(token)
      : extractSessionCookie(res.headers.get("set-cookie"));
  if (!cookie) {
    throw new Error("Login succeeded but no session token was returned");
  }
  return {
    cookie,
    displayName: typeof body.displayName === "string" ? body.displayName : null,
    userId: Number(body.id),
  };
}

export async function fetchMajikMe(sessionCookie: string): Promise<{
  isMember: boolean;
  displayName: string | null;
  userId: number;
}> {
  const res = await apiFetch("/majik/me", {}, sessionCookie);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || "Session check failed");
  }
  return {
    isMember: !!body.isMember,
    displayName: body.displayName ?? null,
    userId: Number(body.userId),
  };
}

export async function fetchCircle(
  sessionCookie: string,
): Promise<MajikCircleSnapshot> {
  const res = await apiFetch("/majik/circle", {}, sessionCookie);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.message || "Failed to load Majik team");
  }
  return body as MajikCircleSnapshot;
}

export async function markUp(sessionCookie: string): Promise<void> {
  const res = await apiFetch(
    "/majik/up",
    { method: "POST", body: "{}" },
    sessionCookie,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to mark up");
  }
}

export async function markDown(sessionCookie: string): Promise<void> {
  const res = await apiFetch(
    "/majik/down",
    { method: "POST", body: "{}" },
    sessionCookie,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Failed to mark down");
  }
}

export function subscribeMajikEvents(
  sessionCookie: string,
  onEvent: (payload: unknown) => void,
): () => void {
  const url = `${API_BASE}/api/majik/events`;
  const controller = new AbortController();

  void (async () => {
    const res = await fetch(url, {
      headers: {
        Accept: "text/event-stream",
        Cookie: sessionCookie,
        ...(bearerFromSession(sessionCookie)
          ? { Authorization: `Bearer ${bearerFromSession(sessionCookie)}` }
          : {}),
      },
      credentials: "include",
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const dataLine = chunk
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        try {
          onEvent(JSON.parse(dataLine.slice(6)));
        } catch {
          /* ignore malformed event */
        }
      }
    }
  })().catch(() => {
    /* stream ended */
  });

  return () => controller.abort();
}
