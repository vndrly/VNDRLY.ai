import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  },
}));

import {
  rankQuickActions,
  readQuickActionUsage,
  recordQuickActionUsage,
} from "@/lib/askv-quick-action-usage";

const actions = [
  { labelKey: "first", prompt: "First" },
  { labelKey: "second", prompt: "Second" },
  { labelKey: "third", prompt: "Third" },
];

describe("AskV quick-action usage", () => {
  beforeEach(() => storage.clear());

  it("ranks frequently used authorized actions first while preserving default tie order", () => {
    expect(rankQuickActions(actions, { third: 4, second: 2 }).map((action) => action.labelKey))
      .toEqual(["third", "second", "first"]);
    expect(rankQuickActions(actions, {}).map((action) => action.labelKey))
      .toEqual(["first", "second", "third"]);
  });

  it("keeps usage separate for each user and active membership", async () => {
    await recordQuickActionUsage(7, 3, "second");
    await recordQuickActionUsage(7, 3, "second");

    expect(await readQuickActionUsage(7, 3)).toEqual({ second: 2 });
    expect(await readQuickActionUsage(7, 4)).toEqual({});
    expect(await readQuickActionUsage(8, 3)).toEqual({});
  });
});
