import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  users: [] as any[],
  read: vi.fn(),
  context: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  usersTable: { id: "id" },
  db: {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [mocks.users.shift()] }),
      }),
    }),
  },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("./field-ticket-access", () => ({ canReadTicket: mocks.read }));
vi.mock("../routes/auth", () => ({ resolveContext: mocks.context }));
import { authorizedTicketCommentRecipients } from "./ticket-comment-access";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({ role: "field_employee", vendorId: 7 });
});
it("filters broadcast-only workers through canonical assignment permission, preserving current assigned recipients", async () => {
  mocks.users = [
    { id: 1, sessionVersion: 4 },
    { id: 2, sessionVersion: 5 },
  ];
  mocks.read.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await authorizedTicketCommentRecipients(10, [1, 2, 2])).toEqual([2]);
  expect(mocks.read).toHaveBeenNthCalledWith(
    1,
    { role: "field_employee", vendorId: 7, userId: 1, sv: 4 },
    10,
  );
});
it("does not resolve or disclose suspended, missing or password-reset recipient contexts", async () => {
  mocks.users = [
    { id: 1, suspendedAt: new Date() },
    undefined,
    { id: 3, mustChangePassword: true },
  ];
  expect(await authorizedTicketCommentRecipients(10, [1, 2, 3])).toEqual([]);
  expect(mocks.read).not.toHaveBeenCalled();
});
