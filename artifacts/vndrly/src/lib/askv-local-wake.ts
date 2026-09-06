import { askVMicrophone, isWakeKeyword, PcmRingBuffer, PcmResampler, type WakeAudioSource } from '@workspace/askv-wake';

export function localWakeSupported(): boolean {
  return Boolean(window.isSecureContext && window.Worker && window.AudioContext && window.AudioWorkletNode && navigator.mediaDevices?.getUserMedia);
}

/** One capture continues across wake -> conversation. Only the realtime client uploads PCM. */
export async function startLocalWake(args: {
  signal: AbortSignal; onWake: (source: WakeAudioSource) => void; onError: (message: string) => void;
}): Promise<{ stop(): Promise<void>; readonly transferred: boolean }> {
  const base = `${import.meta.env.BASE_URL}askv-wake/`;
  let stopped = false, transferred = false, queuedFrames = 0;
  let media: MediaStream | undefined, context: AudioContext | undefined, worker: Worker | undefined;
  let worklet: AudioWorkletNode | undefined, release: (() => Promise<void>) | undefined;
  let sink: ((samples: Float32Array) => void) | undefined;
  const preRoll = new PcmRingBuffer(16000 * 2);
  const connectingAudio = new PcmRingBuffer(16000 * 15);
  let connectingSamples = 0;
  const cleanup = async () => {
    if (stopped) return;
    stopped = true;
    args.signal.removeEventListener('abort', abort);
    worker?.terminate(); worklet?.disconnect();
    media?.getTracks().forEach(track => track.stop());
    preRoll.clear(); connectingAudio.clear(); sink = undefined;
    if (context && context.state !== 'closed') await context.close();
  };
  const stop = async () => { await cleanup(); await release?.(); };
  const abort = () => { if (!transferred) void stop(); };
  const ensureActive = () => { if (stopped || args.signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  args.signal.addEventListener('abort', abort, { once: true });
  try {
    ensureActive(); release = await askVMicrophone.acquire('wake', cleanup); ensureActive();
    worker = new Worker(`${base}worker.js`);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Wake model took too long to load.')), 30000);
      const onAbort = () => { clearTimeout(timer); reject(new DOMException('Cancelled', 'AbortError')); };
      args.signal.addEventListener('abort', onAbort, { once: true });
      worker!.onerror = () => { clearTimeout(timer); reject(new Error('Local wake detection is unavailable.')); };
      worker!.onmessage = ({ data }) => {
        if (data.type !== 'ready' && data.type !== 'error') return;
        clearTimeout(timer); args.signal.removeEventListener('abort', onAbort);
        data.type === 'ready' ? resolve() : reject(new Error(data.message));
      };
    });
    ensureActive();
    worker.onerror = () => { void stop(); args.onError('Local wake detection stopped unexpectedly.'); };
    media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    if (stopped || args.signal.aborted) { media.getTracks().forEach(track => track.stop()); ensureActive(); }
    context = new AudioContext();
    await context.audioWorklet.addModule(`${base}capture-worklet.js`); ensureActive();
    const resampler = new PcmResampler(context.sampleRate, 16000);
    const source: WakeAudioSource = {
      subscribe(callback) {
        if (stopped) throw new Error('Wake audio is no longer available.');
        if (sink) throw new Error('Wake audio already has a consumer.');
        sink = callback;
        const pending = connectingAudio.snapshot(); connectingAudio.clear();
        try { callback(pending); } finally { pending.fill(0); }
        return () => { if (sink === callback) sink = undefined; };
      }, stop,
    };
    worker.onmessage = ({ data }) => {
      if (stopped) return;
      if (data.type === 'consumed') queuedFrames = Math.max(0, queuedFrames - 1);
      if (data.type === 'error') { void stop(); args.onError(data.message); }
      if (data.type === 'wake' && !transferred && isWakeKeyword(data.keyword)) {
        transferred = true;
        connectingAudio.push(preRoll.snapshot()); preRoll.clear();
        worker?.terminate(); worker = undefined;
        args.onWake(source);
      }
    };
    worklet = new AudioWorkletNode(context, 'askv-capture');
    worklet.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      if (stopped) return;
      const samples = resampler.push(data); data.fill(0);
      try { if (transferred) {
        if (sink) sink(samples);
        else {
          connectingSamples += samples.length;
          if (connectingSamples > 16000 * 13) { void stop(); args.onError('Voice took too long to connect. Please open AskV and try again.'); return; }
          connectingAudio.push(samples);
        }
      } else {
        preRoll.push(samples);
        if (queuedFrames > 300) { void stop(); args.onError('This device cannot run local wake detection fast enough.'); return; }
        queuedFrames++; worker?.postMessage({ type: 'audio', samples: samples.slice() });
      }
      } finally { samples.fill(0); }
    };
    context.createMediaStreamSource(media).connect(worklet);
    const silent = context.createGain(); silent.gain.value = 0;
    worklet.connect(silent).connect(context.destination);
    await context.resume(); ensureActive();
    media.getTracks().forEach(track => { track.onended = () => { if (!stopped) { void stop(); args.onError('The microphone disconnected.'); } }; });
    context.onstatechange = () => {
      if (!stopped && context?.state === 'suspended') { void stop(); args.onError('Voice paused because audio was interrupted.'); }
    };
    return { stop, get transferred() { return transferred; } };
  } catch (error) { await stop(); throw error; }
}
