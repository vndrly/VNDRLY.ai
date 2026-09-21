export async function changeOverRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/gate-change-over${path}`,
    {
      credentials: "include",
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(result.message ?? "Unable to complete Change Over"),
      { code: result.code, status: response.status },
    );
  return result as T;
}
