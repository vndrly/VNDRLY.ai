import { getSessionFromRequest } from "./session";

/**
 * Returns a function you can use to validate ANY database result
 * Automatically ensures returned data belongs to the user's tenant
 */
export function enforceTenant(req: any, data: any) {
  const session = getSessionFromRequest(req);

  if (!session) {
    throw new Error("Missing session");
  }

  // Handle arrays (lists)
  if (Array.isArray(data)) {
    return data.filter((item) => {
      if (session.partnerId && item.partnerId) {
        return item.partnerId === session.partnerId;
      }
      if (session.vendorId && item.vendorId) {
        return item.vendorId === session.vendorId;
      }
      return false;
    });
  }

  // Handle single object
  if (data && typeof data === "object") {
    if (
      (session.partnerId && data.partnerId === session.partnerId) ||
      (session.vendorId && data.vendorId === session.vendorId)
    ) {
      return data;
    }

    return null;
  }

  return data;
}