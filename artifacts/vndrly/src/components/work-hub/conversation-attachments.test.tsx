import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationAttachments } from "./conversation-attachments";
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("offers all three choices and selects synthetic files without uploading", async () => {
  const selected = vi.fn();
  render(<ConversationAttachments onSelect={selected} />);
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  for (const name of ["Attach file", "Choose photo", "Take photo"]) expect(screen.getByRole("button", { name })).toBeTruthy();
  const photo = screen.getByLabelText("Choose photo picker");
  expect(photo.getAttribute("accept")).toBe("image/*");
  const file = new File(["mock"], "mock.jpg", { type: "image/jpeg" });
  fireEvent.change(photo, { target: { files: [file] } });
  expect(selected).toHaveBeenCalledWith(file);
});
it("requests video only on Take photo and stops the camera on cancel", async () => {
  const stop = vi.fn();
  const getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  const selected = vi.fn();
  render(<ConversationAttachments onSelect={selected} />);
  expect(getUserMedia).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(stop).toHaveBeenCalledOnce();
  expect(selected).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
it("shows a useful error when camera permission is denied", async () => {
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error(), { name: "NotAllowedError" })) } });
  render(<ConversationAttachments onSelect={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Add attachment" }));
  fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
  expect((await screen.findByRole("alert")).textContent).toContain("permission was denied");
  vi.unstubAllGlobals();
});
