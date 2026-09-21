import { apiFetch } from "./api";
import { replaceSession, type StoredUser } from "./auth";
export function changeOverRequest<T>(path: string, body?: unknown): Promise<T> {
  return apiFetch<T>(
    `/api/gate-change-over${path}`,
    body === undefined ? {} : { method: "POST", body: JSON.stringify(body) },
  );
}
export async function acceptChangeOverSession(result: {
  token: string;
  user: StoredUser;
}) {
  await replaceSession(result.token, result.user);
}
