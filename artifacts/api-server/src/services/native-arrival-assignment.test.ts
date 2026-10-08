import { expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
vi.mock("../lib/objectStore", () => ({}));
vi.mock("../work-hub/events", () => ({}));
vi.mock("./ticket-photo-association", () => ({}));
import { requireLiveNativeTicketAssignment } from "./native-operations";
const actor = { userId: 7, vendorId: 10 };
it("locks canonical ticket, active person and own live crew before allowing arrival", async () => {
 const query = vi.fn().mockResolvedValueOnce({ rows: [{ vendor_id:10,field_employee_id:9 }] }).mockResolvedValueOnce({ rows:[{id:8}] }).mockResolvedValueOnce({rows:[{id:4}]});
 await requireLiveNativeTicketAssignment({query} as any,actor,42);
 expect(query.mock.calls[0][0]).toContain("FOR UPDATE");
 expect(query.mock.calls[1][0]).toContain("is_active=true AND deleted_at IS NULL FOR SHARE");
 expect(query.mock.calls[2][0]).toContain("removed_at IS NULL FOR SHARE");
 expect(query.mock.calls[2][1]).toEqual([42,[8]]);
});
it("rejects a removed assignment even if it passed an earlier projection", async () => {
 const query = vi.fn().mockResolvedValueOnce({ rows:[{vendor_id:10,field_employee_id:9}] }).mockResolvedValueOnce({rows:[{id:8}]}).mockResolvedValueOnce({rows:[]});
 await expect(requireLiveNativeTicketAssignment({query} as any,actor,42)).rejects.toThrow("native.ticket_scope_required");
});
it("rejects a company change and never checks another company's crew", async () => {
 const query = vi.fn().mockResolvedValue({rows:[{vendor_id:11,foreman_user_id:7}]});
 await expect(requireLiveNativeTicketAssignment({query} as any,actor,42)).rejects.toThrow("native.ticket_scope_required");
 expect(query).toHaveBeenCalledTimes(1);
});
