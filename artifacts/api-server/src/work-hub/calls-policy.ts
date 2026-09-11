export function callCanTransition(status: string, action: string, recipient: boolean): boolean {
  if (action === "accept" || action === "decline") return recipient && status === "ringing";
  return action === "end" && (status === "ringing" || status === "active");
}
export function validVoicemailAudio(type: string, body: Buffer): boolean {
  if (body.length < 64 || body.length > 4 * 1024 * 1024) return false;
  if (type === "audio/webm") return body.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  if (type === "audio/ogg") return body.toString("ascii", 0, 4) === "OggS";
  if (type === "audio/mp4") return body.toString("ascii", 4, 8) === "ftyp";
  if (type === "audio/wav") return body.toString("ascii", 0, 4) === "RIFF" && body.toString("ascii", 8, 12) === "WAVE";
  return false;
}
