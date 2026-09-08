import { describe, expect, it } from "vitest";
import { disabledAudioProvider } from "./audio-provider";
describe("disabled Work Hub audio provider", () => { it("never issues credentials or starts capture", async () => { await expect(disabledAudioProvider.createJoinLease()).rejects.toMatchObject({ code: "work_hub.provider_unavailable" }); await expect(disabledAudioProvider.startRecording()).rejects.toMatchObject({ code: "work_hub.provider_unavailable" }); }); });
