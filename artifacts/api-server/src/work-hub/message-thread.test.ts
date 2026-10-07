import { describe, expect, it, vi } from "vitest";
import { resolveMessageThread } from "./message-thread";

describe("saved message ancestry", () => {
  const rows = [
    { id: "A", channelId: "own", parentMessageId: null, rootMessageId: null },
    { id: "B", channelId: "own", parentMessageId: "A", rootMessageId: "A" },
    { id: "foreign", channelId: "other", parentMessageId: null, rootMessageId: null },
  ];
  const read = async (id: string) => rows.find(row => row.id === id);
  it("keeps a reply to B visible in A's original thread", async () => {
    const c = { id: "C", ...await resolveMessageThread("own", { parentMessageId: "B" }, read) };
    expect(c).toEqual({ id: "C", parentMessageId: "B", rootMessageId: "A" });
    expect([rows[0], rows[1], c].filter(row => row.id === "A" || row.rootMessageId === "A").map(row => row.id)).toEqual(["A", "B", "C"]);
  });
  it("accepts an explicitly coherent root and refuses a conflicting or foreign root", async () => {
    await expect(resolveMessageThread("own", { parentMessageId: "B", rootMessageId: "A" }, read)).resolves.toEqual({ parentMessageId: "B", rootMessageId: "A" });
    await expect(resolveMessageThread("own", { parentMessageId: "B", rootMessageId: "B" }, read)).rejects.toThrow();
    await expect(resolveMessageThread("own", { parentMessageId: "foreign" }, read)).rejects.toThrow();
  });
  it("preserves top-level messages without any reference lookup", async () => {
    const lookup = vi.fn(read);
    await expect(resolveMessageThread("own", {}, lookup)).resolves.toEqual({ parentMessageId: null, rootMessageId: null });
    expect(lookup).not.toHaveBeenCalled();
  });
  it.each([null, "B", "foreign"])("derives A from a legacy parent's inconsistent root %s", async rootMessageId => {
    const legacy = async (id: string) => id === "B" ? { id: "B", channelId: "own", parentMessageId: "A", rootMessageId } : read(id);
    await expect(resolveMessageThread("own", { parentMessageId: "B" }, legacy)).resolves.toEqual({ parentMessageId: "B", rootMessageId: "A" });
  });
  it("refuses missing, foreign, cyclic and over-depth parent ancestry", async () => {
    for (const parentMessageId of ["missing", "foreign", "B"]) {
      const lookup = async (id: string) => id === "B" ? { id: "B", channelId: "own", parentMessageId, rootMessageId: "A" } : read(id);
      await expect(resolveMessageThread("own", { parentMessageId: "B" }, lookup)).rejects.toThrow();
    }
    const long = vi.fn(async (id: string) => ({ id, channelId: "own", parentMessageId: String(Number(id) + 1), rootMessageId: null }));
    await expect(resolveMessageThread("own", { parentMessageId: "0" }, long)).rejects.toThrow();
    expect(long).toHaveBeenCalledTimes(64);
  });
});
