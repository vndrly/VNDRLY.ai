import { OpenAIRealtimeWebRTC } from "@workspace/askv-realtime-sdk";

export type AskVMicrophone = MediaStream;
export const openAskVMicrophone = () => navigator.mediaDevices.getUserMedia({ audio: true, video: false });
export function sdkTransport(stream: AskVMicrophone, model: string) {
  return new OpenAIRealtimeWebRTC({ mediaStream: stream, model });
}
