import { afterEach, expect, it, vi } from "vitest";
import {
  uploadFleetEvidence,
  validateFleetEvidenceFile,
  type FleetEvidenceUpload,
} from "./fleet-evidence-upload";
afterEach(() => vi.unstubAllGlobals());
const id = "11111111-1111-4111-8111-111111111111",
  path = `/objects/uploads/${id}`;
const descriptor = {
  uploadURL: `${window.location.origin}/api/storage/upload/${id}`,
  objectPath: path,
};
const json = (value: unknown) =>
  ({ ok: true, json: async () => value }) as Response;
it("retries private finalization with exact file and destination after uncertain response", async () => {
  const file = new File(["bytes"], "r.pdf", { type: "application/pdf" });
  const stage: FleetEvidenceUpload = { file };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json(descriptor))
    .mockResolvedValueOnce(json({}))
    .mockRejectedValueOnce(Error("lost"))
    .mockResolvedValueOnce(json({ objectPath: path }));
  vi.stubGlobal("fetch", fetcher);
  await expect(uploadFleetEvidence(stage, () => true)).rejects.toThrow();
  await expect(uploadFleetEvidence(stage, () => true)).resolves.toBe(path);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(fetcher.mock.calls[1][1].body).toBe(file);
  expect(fetcher.mock.calls[2]).toEqual(fetcher.mock.calls[3]);
  expect(JSON.parse(fetcher.mock.calls[3][1].body)).toMatchObject({
    visibility: "private",
  });
});
it("refuses foreign destinations and unsupported files", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      json({
        ...descriptor,
        uploadURL: `https://foreign.example/api/storage/upload/${id}`,
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    uploadFleetEvidence(
      { file: new File(["x"], "x.pdf", { type: "application/pdf" }) },
      () => true,
    ),
  ).rejects.toThrow("destination");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(() =>
    validateFleetEvidenceFile(new File(["x"], "x.html", { type: "text/html" })),
  ).toThrow();
});
it("does not upload after context revocation", async () => {
  let current = true;
  const fetcher = vi.fn().mockImplementation(async () => {
    current = false;
    return json(descriptor);
  });
  vi.stubGlobal("fetch", fetcher);
  await expect(
    uploadFleetEvidence(
      { file: new File(["x"], "x.pdf", { type: "application/pdf" }) },
      () => current,
    ),
  ).rejects.toThrow("account changed");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
