import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  askvTextOnlyKey,
  readAskVAcrossVndrly,
  readAskVMuted,
  readAskVTextOnly,
  writeAskVAcrossVndrly,
  writeAskVMuted,
  writeAskVTextOnly,
} from "./askv-voice-preferences";

describe("AskV web voice preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("persists remembered text-only mode per user", () => {
    expect(readAskVTextOnly(11)).toBe(false);
    writeAskVTextOnly(11, true);
    expect(window.localStorage.getItem(askvTextOnlyKey(11))).toBe("1");
    expect(readAskVTextOnly(11)).toBe(true);
    expect(readAskVTextOnly(12)).toBe(false);
  });

  it("emits a change event when toggled", () => {
    const listener = vi.fn();
    window.addEventListener("askv:text-only-changed", listener);
    writeAskVTextOnly(11, true);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("askv:text-only-changed", listener);
  });

  it("remembers mute and across-VNDRLY separately from text-only", () => {
    expect(readAskVMuted(11)).toBe(false);
    expect(readAskVAcrossVndrly(11)).toBe(false);
    writeAskVMuted(11, true);
    writeAskVAcrossVndrly(11, true);
    expect(readAskVMuted(11)).toBe(true);
    expect(readAskVAcrossVndrly(11)).toBe(true);
    expect(readAskVTextOnly(11)).toBe(false);
  });
  it('honors the old text-only preference until the user explicitly unmutes', () => {
    writeAskVTextOnly(11, true); expect(readAskVMuted(11)).toBe(true);
    writeAskVMuted(11, false); expect(readAskVMuted(11)).toBe(false);
  });
  it('broadcasts mute immediately even when browser storage fails', () => {
    const listener = vi.fn(); window.addEventListener('askv:muted-changed', listener);
    const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    writeAskVMuted(11, true); expect(listener).toHaveBeenCalledOnce();
    storage.mockRestore(); window.removeEventListener('askv:muted-changed', listener);
  });
});
