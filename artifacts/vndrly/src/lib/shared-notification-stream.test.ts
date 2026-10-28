import { afterEach, expect, it, vi } from "vitest";
import { subscribeNotificationStream } from "./shared-notification-stream";

class Source {
  static instances: Source[] = [];
  closed = false;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();
  constructor(public url: string, public options: { withCredentials: boolean }) { Source.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) { this.listeners.set(type, listener); }
  close() { this.closed = true; }
  emit(type: string, data: string) { this.listeners.get(type)?.(new MessageEvent(type, { data })); }
}
class Channel {
  static instances = new Set<Channel>();
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(public name: string) { Channel.instances.add(this); }
  postMessage(data: unknown) { for (const other of Channel.instances) if (other !== this && other.name === this.name) other.onmessage?.({ data }); }
  close() { Channel.instances.delete(this); }
}
function setup() {
  Source.instances = [];
  const active = new Set<string>();
  const queues = new Map<string, (() => void)[]>();
  const request = (name: string, { signal }: { signal: AbortSignal }, work: () => Promise<void>) => new Promise<void>((resolve, reject) => {
    let held = false;
    const start = () => {
      if (signal.aborted) { reject(new Error("Aborted")); return; }
      if (active.has(name)) { queues.set(name, [...(queues.get(name) ?? []), start]); return; }
      active.add(name);
      held = true;
      Promise.resolve().then(work).then(resolve, reject).finally(() => { active.delete(name); queues.get(name)?.shift()?.(); });
    };
    signal.addEventListener("abort", () => {
      if (held) return;
      queues.set(name, (queues.get(name) ?? []).filter(waiter => waiter !== start));
      reject(new Error("Aborted"));
    }, { once: true });
    start();
  });
  vi.stubGlobal("EventSource", Source);
  vi.stubGlobal("BroadcastChannel", Channel);
  vi.stubGlobal("navigator", { locks: { request } });
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const stops: (() => void)[] = [];
afterEach(async () => { stops.splice(0).forEach(stop => stop()); await flush(); Channel.instances.clear(); vi.unstubAllGlobals(); });

it("uses one authenticated connection for seven tabs and delivers events to every tab", async () => {
  setup();
  const listeners = Array.from({ length: 7 }, () => vi.fn());
  for (const listener of listeners) stops.push(subscribeNotificationStream("/api/notifications/events", "user:7:company:4", listener));
  await flush();
  expect(Source.instances).toHaveLength(1);
  expect(Source.instances[0].options.withCredentials).toBe(true);
  Source.instances[0].emit("notification.created", '{"notificationId":22}');
  for (const listener of listeners) expect(listener).toHaveBeenCalledWith("notification.created", expect.objectContaining({ data: '{"notificationId":22}' }));
});
it("hands the connection to another tab when its owner closes and never opens a cancelled follower", async () => {
  setup();
  const first = vi.fn(), cancelled = vi.fn(), next = vi.fn();
  const owner = subscribeNotificationStream("/events", "same-account", first); stops.push(owner);
  const waiting = subscribeNotificationStream("/events", "same-account", cancelled); stops.push(waiting);
  stops.push(subscribeNotificationStream("/events", "same-account", next));
  await flush();
  waiting(); owner(); await flush();
  expect(Source.instances).toHaveLength(2);
  expect(Source.instances[0].closed).toBe(true);
  Source.instances[1].emit("notification.state_changed", "{}");
  expect(next).toHaveBeenCalledOnce();
  expect(first).not.toHaveBeenCalled(); expect(cancelled).not.toHaveBeenCalled();
});
it("keeps different account contexts isolated", async () => {
  setup();
  const one = vi.fn(), two = vi.fn();
  stops.push(subscribeNotificationStream("/events", "user:7:company:4", one));
  stops.push(subscribeNotificationStream("/events", "user:7:company:5", two));
  await flush();
  expect(Source.instances).toHaveLength(2);
  Source.instances[0].emit("notification.created", "{}");
  expect(one).toHaveBeenCalledOnce(); expect(two).not.toHaveBeenCalled();
});
it("retains the existing connection behavior when cross-tab coordination is unavailable", () => {
  setup(); vi.stubGlobal("BroadcastChannel", undefined);
  const listener = vi.fn();
  const stop = subscribeNotificationStream("/events", "account", listener); stops.push(stop);
  expect(Source.instances).toHaveLength(1);
  Source.instances[0].emit("notification.hello", "{}");
  expect(listener).toHaveBeenCalledOnce(); stop(); expect(Source.instances[0].closed).toBe(true);
});
