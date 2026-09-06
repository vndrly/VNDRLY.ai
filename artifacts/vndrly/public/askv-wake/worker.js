/* Local-only inference. PCM stays in this worker's memory and is never uploaded. */
self.global = self; // Pinned runtime wrappers expect a global alias in Web Workers.
let spotter, stream, enabled = true;
self.Module = {
  locateFile: (name) => new URL(`runtime/${name}`, self.location.href).href,
  print: () => {}, printErr: () => {},
  onRuntimeInitialized: async () => {
    try {
      Module.FS.mkdir('/model');
      for (const name of ['encoder.onnx', 'decoder.onnx', 'joiner.onnx', 'tokens.txt', 'keywords.txt']) {
        const response = await fetch(new URL(`model/${name}`, self.location.href));
        if (!response.ok) throw new Error('model unavailable');
        Module.FS.writeFile(`/model/${name}`, new Uint8Array(await response.arrayBuffer()));
      }
      spotter = createKws(Module, {
        featConfig: { samplingRate: 16000, featureDim: 80 },
        modelConfig: { transducer: { encoder: '/model/encoder.onnx', decoder: '/model/decoder.onnx', joiner: '/model/joiner.onnx' },
          tokens: '/model/tokens.txt', provider: 'cpu', modelType: '', numThreads: 1, debug: 0, modelingUnit: 'bpe', bpeVocab: '' },
        maxActivePaths: 4, numTrailingBlanks: 1, keywordsScore: 1, keywordsThreshold: 0.25, keywordsFile: '/model/keywords.txt',
      });
      if (!spotter.handle) throw new Error('local keyword engine unavailable');
      stream = spotter.createStream();
      if (!stream.handle) throw new Error('local keyword stream unavailable');
      self.postMessage({ type: 'ready' });
    } catch { self.postMessage({ type: 'error', message: 'Local wake detection could not start.' }); }
  },
};
importScripts('runtime/sherpa-onnx-core.js', 'runtime/sherpa-onnx-kws.js', 'runtime/sherpa-onnx-wasm-combined.js');
self.onmessage = ({ data }) => {
  if (data.type !== 'audio') return;
  if (!enabled || !stream) { data.samples?.fill(0); return; }
  try {
    stream.acceptWaveform(16000, data.samples);
    while (spotter.isReady(stream)) {
      spotter.decode(stream);
      const result = spotter.getResult(stream);
      if (result.keyword) { spotter.reset(stream); enabled = false; self.postMessage({ type: 'wake', keyword: result.keyword }); break; }
    }
  } catch { self.postMessage({ type: 'error', message: 'Local wake detection stopped.' }); }
  finally { data.samples.fill(0); self.postMessage({ type: 'consumed' }); }
};
