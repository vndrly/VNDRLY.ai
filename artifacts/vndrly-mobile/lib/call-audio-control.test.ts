import { expect, it, vi } from "vitest";
import { registerCallAudioShutdown, closeInternalCallAudio } from "./call-audio-control";
it("awaits the owned audio shutdown before the caller can end its record",async()=>{
  let finish!:()=>void;
  const shutdown=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
  const remove=registerCallAudioShutdown("call",shutdown);
  let closed=false;const request=closeInternalCallAudio("call").then(()=>{closed=true;});
  expect(shutdown).toHaveBeenCalledOnce();expect(closed).toBe(false);
  finish();await request;expect(closed).toBe(true);remove();
});
