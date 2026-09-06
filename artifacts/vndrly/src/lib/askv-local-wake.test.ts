import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLocalWake, localWakeSupported } from './askv-local-wake';
import { askVMicrophone, type WakeAudioSource } from '@workspace/askv-wake';
class WorkerFake {
  static last: WorkerFake; static autoReady = true;
  onmessage: ((event: { data: any }) => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { WorkerFake.last = this; if (WorkerFake.autoReady) queueMicrotask(() => this.emit({ type: 'ready' })); }
  emit(data: object) { this.onmessage?.({ data }); }
}
class ContextFake {
  state = 'running'; sampleRate = 16000;
  audioWorklet = { addModule: vi.fn(async () => {}) }; destination = {};
  close = vi.fn(async () => { this.state = 'closed'; }); resume = vi.fn(async () => {});
  createMediaStreamSource() { return { connect() {} }; }
  createGain() { return { gain: { value: 1 }, connect() {} }; }
}
class WorkletFake {
  static last: WorkletFake;
  port = { onmessage: null as null | ((event: { data: Float32Array }) => void) };
  constructor() { WorkletFake.last = this; }
  disconnect = vi.fn(); connect(value: any) { return value; }
  emit(value: number) { this.port.onmessage?.({ data: new Float32Array(160).fill(value) }); }
}
describe('local wake capture ownership', () => {
  let controller: AbortController, listener: Awaited<ReturnType<typeof startLocalWake>> | undefined;
  let track: { stop: ReturnType<typeof vi.fn> }, source: WakeAudioSource | undefined;
  beforeEach(() => {
    WorkerFake.autoReady = true; controller = new AbortController(); listener = undefined; source = undefined;
    track = { stop: vi.fn() };
    vi.stubGlobal('Worker', WorkerFake); vi.stubGlobal('AudioContext', ContextFake); vi.stubGlobal('AudioWorkletNode', WorkletFake);
    vi.stubGlobal('isSecureContext', true);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) } });
  });
  afterEach(async () => { controller.abort(); await source?.stop(); await listener?.stop(); vi.unstubAllGlobals(); });
  it('does not request a microphone on unsupported browsers', () => {
    vi.stubGlobal('Worker', undefined); expect(localWakeSupported()).toBe(false); expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
  it('cancels model startup without acquiring the microphone', async () => {
    WorkerFake.autoReady = false;
    const pending = startLocalWake({ signal: controller.signal, onWake: vi.fn(), onError: vi.fn() });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(WorkerFake.last).toBeDefined()); controller.abort(); await rejected;
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });
  it('stops a microphone granted after mute during the permission prompt', async () => {
    let grant!: (value: any) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(() => new Promise(resolve => { grant = resolve; }));
    const pending = startLocalWake({ signal: controller.signal, onWake: vi.fn(), onError: vi.fn() });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(grant).toBeDefined()); controller.abort(); grant({ getTracks: () => [track] }); await rejected;
    expect(track.stop).toHaveBeenCalledOnce(); expect(askVMicrophone.owner).toBeNull();
  });
  it('transfers bounded pre-roll and continuing speech exactly once without reopening capture', async () => {
    const wake = vi.fn((value: WakeAudioSource) => { source = value; });
    listener = await startLocalWake({ signal: controller.signal, onWake: wake, onError: vi.fn() });
    WorkletFake.last.emit(0.25); WorkerFake.last.emit({ type: 'consumed' });
    WorkerFake.last.emit({ type: 'wake', keyword: 'V' }); expect(wake).not.toHaveBeenCalled();
    WorkerFake.last.emit({ type: 'wake', keyword: 'ASKV' }); WorkerFake.last.emit({ type: 'wake', keyword: 'ASKV' });
    expect(wake).toHaveBeenCalledOnce(); expect(listener.transferred).toBe(true);
    controller.abort(); expect(track.stop).not.toHaveBeenCalled();
    WorkletFake.last.emit(0.5);
    const frames: Float32Array[] = []; source!.subscribe(samples => frames.push(samples.slice()));
    WorkletFake.last.emit(0.75);
    expect(frames[0].some(value => value === 0.25)).toBe(true);
    expect(frames[0].some(value => value === 0.5)).toBe(true);
    expect(frames[1].some(value => value === 0.75)).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    await source!.stop(); expect(track.stop).toHaveBeenCalledOnce();
  });
  it('releases local capture before another VNDRLY feature can own the mic', async () => {
    listener = await startLocalWake({ signal: controller.signal, onWake: vi.fn(), onError: vi.fn() });
    const release = await askVMicrophone.acquire('gate', async () => {});
    expect(track.stop).toHaveBeenCalledOnce(); expect(WorkerFake.last.terminate).toHaveBeenCalledOnce();
    expect(askVMicrophone.owner).toBe('gate'); await release();
  });
});
