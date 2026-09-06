import { expect, it, vi } from 'vitest';
import { AskVTranscriptQueue } from './askv-transcript-queue';
it('retains a failed voice turn and retries it before later turns or history changes', async () => {
  const queue = new AskVTranscriptQueue(), order: string[] = [];
  const first = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => { order.push('first'); });
  queue.add(first); queue.add(async () => { order.push('second'); });
  await expect(queue.flush()).rejects.toThrow('offline');
  expect(order).toEqual([]);
  await queue.flush(); expect(order).toEqual(['first', 'second']);
  await queue.flush(); expect(first).toHaveBeenCalledTimes(2);
});
it('serializes concurrent flushes and includes turns arriving while a save is pending', async () => {
  const queue = new AskVTranscriptQueue(); let release!: () => void;
  const next = vi.fn(async () => {});
  queue.add(() => new Promise<void>(resolve => { release = resolve; }));
  const running = queue.flush(); queue.add(next);
  expect(queue.flush()).toBe(running); expect(next).not.toHaveBeenCalled();
  release(); await running; expect(next).toHaveBeenCalledOnce();
});
