import { describe, expect, it, vi } from 'vitest';
import { createAskVCapabilityCache } from './askv-capability-cache';
describe('voice capability recovery', () => {
  it('retries failed availability, coalesces requests and refreshes changed capabilities', async () => {
    let now = 0;
    const load = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const read = createAskVCapabilityCache(load, Boolean, () => now, 30);
    const first = read(); expect(read()).toBe(first);
    expect(await first).toBe(false);
    expect(await read()).toBe(true);
    expect(await read()).toBe(true); expect(load).toHaveBeenCalledTimes(2);
    now = 31; expect(await read()).toBe(false);
    expect(load).toHaveBeenCalledTimes(3);
  });
  it('does not cache a rejected network request', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(true);
    const read = createAskVCapabilityCache(load, Boolean);
    await expect(read()).rejects.toThrow('offline');
    expect(await read()).toBe(true);
  });
});
