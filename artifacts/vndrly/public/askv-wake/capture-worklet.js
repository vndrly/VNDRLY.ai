class AskVCapture extends AudioWorkletProcessor {
  process(inputs) {
    const mono = inputs[0]?.[0];
    if (mono) { const copy = mono.slice(); this.port.postMessage(copy, [copy.buffer]); }
    return true;
  }
}
registerProcessor('askv-capture', AskVCapture);
