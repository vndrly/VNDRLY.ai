import { mediaDevices, type MediaStream } from "react-native-webrtc";
import { ReactNativeWebRTCTransport } from "./ReactNativeWebRTCTransport";

export type AskVMicrophone = MediaStream;
export const openAskVMicrophone = () => mediaDevices.getUserMedia({ audio: true, video: false });
export function sdkTransport(stream: AskVMicrophone, model: string) {
  return new ReactNativeWebRTCTransport({ mediaStream: stream, model });
}
