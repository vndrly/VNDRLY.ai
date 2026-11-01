import { expect, it } from "vitest";
import { equipmentPhotoPath } from "./equipment-photo";
const id = "10000000-0000-4000-8000-000000000001", path = `/api/storage/objects/uploads/${id}`;
it("converts finalized upload object paths to the backend's relative equipment photo route", () => {
  expect(equipmentPhotoPath(`/objects/uploads/${id}`, "https://vndrly.ai")).toBe(path);
  expect(equipmentPhotoPath(path, "https://vndrly.ai")).toBe(path);
  expect(equipmentPhotoPath(`https://vndrly.ai${path}`, "https://vndrly.ai")).toBe(path);
});
it("refuses another origin or a non-upload photo route", () => {
  expect(() => equipmentPhotoPath(`https://other.invalid${path}`, "https://vndrly.ai")).toThrow("Unexpected equipment photo path");
  expect(() => equipmentPhotoPath("/objects/not-an-upload", "https://vndrly.ai")).toThrow("Unexpected equipment photo path");
});
