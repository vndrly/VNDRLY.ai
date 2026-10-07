import i18n from "./i18n";

export async function changeOverRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const signal = AbortSignal.timeout(30_000);
  try {
    const response = await fetch(
    `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/gate-change-over${path}`,
    {
      credentials: "include",
      method: body === undefined ? "GET" : "POST",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    },
  );
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(
        new Error(result.message ?? "Unable to complete Change Over"),
        { code: result.code, status: response.status },
      );
    return result as T;
  } catch (error) {
    if (signal.aborted)
      throw new Error(
        i18n.t(body === undefined ? "changeOver.readTimeout" : "changeOver.writeUnconfirmed"),
      );
    throw error;
  }
}
