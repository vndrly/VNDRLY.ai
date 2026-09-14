export async function implementationARequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/implementation-a${path}`, {
    credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, ...init,
  });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.code ?? "Request failed");
  return response.json() as Promise<T>;
}
