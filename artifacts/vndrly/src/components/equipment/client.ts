export async function equipmentRequest<T>(path = "", init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/equipment${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...init?.headers } });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.message || data.error || data.code || "Equipment request failed"), { status: response.status });
  return data as T;
}
export const equipmentPhoto = (path: string) => path.startsWith("/objects/uploads/") ? `/api/storage${path}` : path;
