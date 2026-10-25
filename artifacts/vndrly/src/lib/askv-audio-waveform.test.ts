import { expect, it, vi } from "vitest";
import { observeAskVPcm, readAskVWaveform, observeAskVAudio } from "./askv-audio-waveform";
it("shows actual samples, expires stale audio, and clears on stop",()=>{
 const clock=vi.spyOn(performance,"now").mockReturnValue(1000);
 const meter=observeAskVPcm(); meter.push(new Float32Array([0,.5,-.5,0]));
 expect(Array.from(readAskVWaveform())).toEqual([0,.5,-.5,0]);
 clock.mockReturnValue(1200);expect(readAskVWaveform().every(x=>x===0)).toBe(true);
 meter.push(new Float32Array([.25]));meter.stop();expect(readAskVWaveform().every(x=>x===0)).toBe(true);clock.mockRestore();
});
it("does not break voice if analysis is unsupported",()=>{
 vi.stubGlobal("AudioContext",undefined);
 expect(()=>observeAskVAudio({} as MediaStream)()).not.toThrow();vi.unstubAllGlobals();
});
