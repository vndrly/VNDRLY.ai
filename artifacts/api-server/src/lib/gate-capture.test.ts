import { expect,it } from "vitest";
import { gateCaptureInput } from "./gate-capture";
const path="/objects/uploads/11111111-1111-4111-8111-111111111111";
const image={objectPath:path,originalPath:path,kind:"plate",capturedAt:"2026-11-12T12:00:00.000Z"};
it("accepts original/crop relationships and an explicit run reference",()=>{
 expect(gateCaptureInput.parse({images:[image],arrivalRunId:"11111111-1111-4111-8111-111111111111"}).images).toHaveLength(1);
});
it("rejects remote paths, forged server metadata and oversized capture lists",()=>{
 expect(gateCaptureInput.safeParse({images:[{...image,originalPath:"https://example.com/photo"}]}).success).toBe(false);
 expect(gateCaptureInput.safeParse({images:[image],recordedByUserId:1}).success).toBe(false);
 expect(gateCaptureInput.safeParse({images:Array(13).fill(image)}).success).toBe(false);
});
