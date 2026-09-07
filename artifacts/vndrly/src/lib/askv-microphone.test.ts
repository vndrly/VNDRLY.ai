import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureAskVMicrophone, getAskVMicrophoneState, meterAskVMicrophone, observeAskVMicrophones, selectAskVMicrophone } from './askv-microphone';

describe('microphone selection and local level lifecycle', () => {
  let controller: AbortController, meter: ReturnType<typeof meterAskVMicrophone> | undefined;
  let track: EventTarget & { label: string; enabled: boolean; stop: ReturnType<typeof vi.fn> };
  let stream: MediaStream;
  beforeEach(() => {
    controller = new AbortController(); meter = undefined; selectAskVMicrophone('');
    track = Object.assign(new EventTarget(), { label: 'Wired headset', enabled: true, stop: vi.fn() });
    stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
    const mediaDevices = Object.assign(new EventTarget(), {
      getUserMedia: vi.fn(async () => stream), enumerateDevices: vi.fn(async () => []),
    });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
  });
  afterEach(() => { meter?.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it.each(['NotFoundError', 'OverconstrainedError'])('uses the default once when the selected device fails with %s', async name => {
    selectAskVMicrophone('unplugged');
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException('Device missing', name));
    const capture = await captureAskVMicrophone(controller.signal);
    expect(capture.fallback).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenNthCalledWith(2, { audio: {
      echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    }, video: false });
    meter = meterAskVMicrophone(capture);
    expect(getAskVMicrophoneState()).toMatchObject({ active: true, activeLabel: 'Wired headset', fallback: true });
  });

  it('does not retry microphone access after permission denial', async () => {
    selectAskVMicrophone('headset');
    vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'));
    await expect(captureAskVMicrophone(controller.signal)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
    expect(getAskVMicrophoneState().active).toBe(false);
  });

  it('does not retry a missing microphone after cancellation', async () => {
    selectAskVMicrophone('headset');
    vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(async () => {
      controller.abort(); throw new DOMException('Device missing', 'NotFoundError');
    });
    await expect(captureAskVMicrophone(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  });

  it('stops a fallback stream granted after the permission request was cancelled', async () => {
    selectAskVMicrophone('headset');
    vi.mocked(navigator.mediaDevices.getUserMedia)
      .mockRejectedValueOnce(new DOMException('Device missing', 'NotFoundError'))
      .mockImplementationOnce(async () => { controller.abort(); return stream; });
    await expect(captureAskVMicrophone(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(track.stop).toHaveBeenCalledOnce();
    expect(getAskVMicrophoneState().active).toBe(false);
  });

  it('refreshes device removal without opening capture and removes its observer', async () => {
    const enumerate = vi.mocked(navigator.mediaDevices.enumerateDevices);
    enumerate.mockResolvedValueOnce([{ kind: 'audioinput', deviceId: 'headset', label: 'Wired headset' } as MediaDeviceInfo]);
    const stop = observeAskVMicrophones();
    await vi.waitFor(() => expect(getAskVMicrophoneState().devices).toHaveLength(1));
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    await vi.waitFor(() => expect(getAskVMicrophoneState().devices).toHaveLength(0));
    stop(); navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    expect(enumerate).toHaveBeenCalledTimes(2);
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it('ignores device results that finish after the settings observer is removed', async () => {
    let resolve!: (devices: MediaDeviceInfo[]) => void;
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const stop = observeAskVMicrophones(); stop();
    resolve([{ kind: 'audioinput', deviceId: 'stale', label: 'Stale headset' } as MediaDeviceInfo]);
    await Promise.resolve();
    expect(getAskVMicrophoneState().devices.some(device => device.deviceId === 'stale')).toBe(false);
  });

  it('uses existing wake frames without modifying them and clears the level when the track ends', async () => {
    const samples = new Float32Array([0.125, -0.125]);
    meter = meterAskVMicrophone(await captureAskVMicrophone(controller.signal)); meter.push(samples);
    expect(getAskVMicrophoneState().level).toBe(0.5);
    expect(samples).toEqual(new Float32Array([0.125, -0.125]));
    track.dispatchEvent(new Event('ended'));
    expect(getAskVMicrophoneState()).toMatchObject({ active: false, level: 0 });
    meter.push(samples);
    expect(getAskVMicrophoneState().active).toBe(false);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  });

  it('analyzes only the active stream and releases animation and audio resources on stop', async () => {
    let tick!: FrameRequestCallback;
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const analyser = { fftSize: 256, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0.125), disconnect: vi.fn() };
    const createSource = vi.fn(() => source), close = vi.fn(async () => {});
    vi.stubGlobal('AudioContext', class {
      state = 'running'; createMediaStreamSource = createSource; createAnalyser = () => analyser;
      resume = async () => {}; close = close;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { tick = callback; return 7; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    meter = meterAskVMicrophone(await captureAskVMicrophone(controller.signal), true);
    await Promise.resolve();
    expect(createSource).toHaveBeenCalledWith(stream);
    expect(getAskVMicrophoneState().level).toBe(0.5);
    meter.stop(); tick(200);
    expect(getAskVMicrophoneState()).toMatchObject({ active: false, level: 0 });
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    expect(source.disconnect).toHaveBeenCalledOnce(); expect(analyser.disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce(); expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  });
});
