import { describe, expect, it, vi } from "vitest";
vi.mock("expo-crypto", () => ({
  randomUUID: () => "10000000-0000-4000-8000-000000000001",
}));
vi.mock("./photos", () => ({ captureAndUploadImage: vi.fn() }));
import {
  associateTicketPhoto,
  type TicketPhotoAttempt,
  type TicketPhotoReceipt,
} from "./ticket-photo-association";
const account = "10.vendor.20.30.",
  ticketId = 40;
const attempt: TicketPhotoAttempt = {
  account,
  ticketId,
  operationId: "10000000-0000-4000-8000-000000000001",
  objectPath: "/objects/uploads/20000000-0000-4000-8000-000000000002",
};
const receipt: TicketPhotoReceipt = {
  ...attempt,
  noteId: 50,
  status: "applied",
  physicalCaptureVerified: false,
};
function setup(saved: TicketPhotoAttempt | null = null) {
  let value = saved;
  const dependencies = {
    current: () => true,
    read: vi.fn(async () => value),
    write: vi.fn(async (next: TicketPhotoAttempt) => {
      value = next;
    }),
    clear: vi.fn(async () => {
      value = null;
    }),
    capture: vi.fn(async () => ({ objectPath: attempt.objectPath })),
    operationId: () => attempt.operationId,
    get: vi.fn(async () => receipt),
    post: vi.fn(async () => receipt),
  };
  return { dependencies, saved: () => value };
}
describe("native exact ticket photo association", () => {
  it("persists actual upload before POST and recovers dropped result without another capture or mutation", async () => {
    const test = setup();
    test.dependencies.post.mockImplementationOnce(async () => {
      expect(test.saved()).toEqual(attempt);
      throw new Error("lost response");
    });
    await expect(
      associateTicketPhoto(account, ticketId, test.dependencies),
    ).rejects.toThrow("lost response");
    expect(test.saved()).toEqual(attempt);
    expect(
      await associateTicketPhoto(account, ticketId, test.dependencies),
    ).toEqual(receipt);
    expect(test.dependencies.capture).toHaveBeenCalledTimes(1);
    expect(test.dependencies.post).toHaveBeenCalledTimes(1);
    expect(test.dependencies.get).toHaveBeenCalledWith(attempt);
    expect(test.saved()).toBeNull();
  });
  it("retries only the exact missing association with original UUID and private path", async () => {
    const test = setup(attempt);
    test.dependencies.get.mockRejectedValueOnce({
      status: 404,
      code: "ticket.photo_association_not_found",
    });
    await associateTicketPhoto(account, ticketId, test.dependencies);
    expect(test.dependencies.post).toHaveBeenCalledWith(attempt);
    expect(test.dependencies.capture).not.toHaveBeenCalled();
  });
  it.each([
    { status: 404, code: "ticket.not_found" },
    { status: 403 },
    { status: 401 },
  ])(
    "retains unknown attempt without replay after current authorization refusal %j",
    async (error) => {
      const test = setup(attempt);
      test.dependencies.get.mockRejectedValueOnce(error);
      await expect(
        associateTicketPhoto(account, ticketId, test.dependencies),
      ).rejects.toEqual(error);
      expect(test.dependencies.post).not.toHaveBeenCalled();
      expect(test.saved()).toEqual(attempt);
    },
  );
  it("refuses switched account after capture and never persists or attaches under another identity", async () => {
    const test = setup();
    let current = true;
    test.dependencies.current = () => current;
    test.dependencies.capture.mockImplementationOnce(async () => {
      current = false;
      return { objectPath: attempt.objectPath };
    });
    await expect(
      associateTicketPhoto(account, ticketId, test.dependencies),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(test.dependencies.write).not.toHaveBeenCalled();
    expect(test.dependencies.post).not.toHaveBeenCalled();
  });
  it("refuses another account or mismatched saved receipt without clearing recovery", async () => {
    const test = setup(attempt);
    await expect(
      associateTicketPhoto("other", ticketId, test.dependencies),
    ).rejects.toThrow("another account");
    test.dependencies.get.mockResolvedValueOnce({ ...receipt, ticketId: 99 });
    await expect(
      associateTicketPhoto(account, ticketId, test.dependencies),
    ).rejects.toThrow("not verified");
    expect(test.saved()).toEqual(attempt);
    expect(test.dependencies.post).not.toHaveBeenCalled();
  });
});
