import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readAskVAcrossVndrly,
  readAskVMuted,
  readAskVTextOnly,
  writeAskVAcrossVndrly,
  writeAskVMuted,
  writeAskVTextOnly,
} from "../askvVoicePreferences";

const store = new Map<string, string>();
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
function validateKey(key: string) {
  // Expo SecureStore rejects colons on device, even though a Map accepts them.
  if (!/^[\w.-]+$/.test(key)) throw new Error("Invalid SecureStore key");
}

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async (key: string) => { validateKey(key); return store.get(key) ?? null; }),
  setItemAsync: vi.fn(async (key: string, value: string) => {
    validateKey(key);
    store.set(key, value);
  }),
  deleteItemAsync: vi.fn(async (key: string) => {
    validateKey(key);
    store.delete(key);
  }),
}));

describe("mobile AskV voice preferences", () => {
  beforeEach(() => {
    store.clear();
  });

  it("persists remembered text-only mode per user", async () => {
    expect(await readAskVTextOnly(11)).toBe(false);
    await writeAskVTextOnly(11, true);
    expect(await readAskVTextOnly(11)).toBe(true);
    expect(await readAskVTextOnly(12)).toBe(false);
    await writeAskVTextOnly(11, false);
    expect(await readAskVTextOnly(11)).toBe(false);
  });

  it("remembers mute and across-VNDRLY separately from text-only", async () => {
    expect(await readAskVMuted(11)).toBe(false);
    expect(await readAskVAcrossVndrly(11)).toBe(false);
    await writeAskVMuted(11, true);
    await writeAskVAcrossVndrly(11, true);
    expect(await readAskVMuted(11)).toBe(true);
    expect(await readAskVAcrossVndrly(11)).toBe(true);
    expect(await readAskVTextOnly(11)).toBe(false);
  });
});
