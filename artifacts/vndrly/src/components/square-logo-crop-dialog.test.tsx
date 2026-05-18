import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Radix DialogContent uses @radix-ui/react-use-size which constructs a
// ResizeObserver — jsdom doesn't ship one, so install a no-op stub
// before any component renders.
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

// Dialog internally calls useAuth via the auto-entity-logo helper to
// pick a header logo; mock it so the component renders standalone.
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { userId: 1, role: "admin" } }),
}));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ logoUrl: null, logoSquareUrl: null }),
}));

const cropToSquareMock = vi.fn();
const fitImageIntoSquareMock = vi.fn();
vi.mock("@/lib/image-resize", () => ({
  cropToSquare: (...args: unknown[]) => cropToSquareMock(...args),
  fitImageIntoSquare: (...args: unknown[]) => fitImageIntoSquareMock(...args),
}));

vi.mock("react-easy-crop", () => ({
  default: ({
    onCropComplete,
  }: {
    onCropComplete: (
      area: { x: number; y: number; width: number; height: number },
      pixels: { x: number; y: number; width: number; height: number },
    ) => void;
  }) => {
    React.useEffect(() => {
      onCropComplete(
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 0, y: 0, width: 100, height: 100 },
      );
    }, [onCropComplete]);
    return <div data-testid="cropper-stub" />;
  },
}));

import { SquareLogoCropDialog } from "./square-logo-crop-dialog";

const ORIG_CREATE_OBJECT_URL = URL.createObjectURL;
const ORIG_REVOKE_OBJECT_URL = URL.revokeObjectURL;

beforeEach(() => {
  toastMock.mockReset();
  cropToSquareMock.mockReset();
  fitImageIntoSquareMock.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:mock") as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn() as typeof URL.revokeObjectURL;
});

afterEach(() => {
  URL.createObjectURL = ORIG_CREATE_OBJECT_URL;
  URL.revokeObjectURL = ORIG_REVOKE_OBJECT_URL;
});

function renderWithClient(node: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

describe("SquareLogoCropDialog error handling", () => {
  it("toasts and keeps the modal open when cropToSquare throws", async () => {
    const file = new File(["x"], "wide.png", { type: "image/png" });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    cropToSquareMock.mockRejectedValueOnce(new Error("canvas exploded"));

    renderWithClient(
      <SquareLogoCropDialog
        file={file}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    // Wait for the cropper stub to fire its onCropComplete (giving us
    // valid croppedAreaPixels) before clicking confirm — otherwise
    // handleConfirm short-circuits on the !croppedAreaPixels guard.
    await screen.findByTestId("cropper-stub");

    fireEvent.click(screen.getByTestId("square-logo-crop-confirm"));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Failed to crop image",
          variant: "destructive",
        }),
      );
    });
    expect(onConfirm).not.toHaveBeenCalled();
    // Critical: the dialog must NOT auto-close on crop error so the
    // user can adjust their selection and retry.
    expect(onClose).not.toHaveBeenCalled();
    // And the modal is still in the DOM.
    expect(screen.getByTestId("square-logo-crop-dialog")).toBeTruthy();
  });

  it("calls onConfirm with the cropped file on success", async () => {
    const file = new File(["x"], "wide.png", { type: "image/png" });
    const cropped = new File(["y"], "wide.png", { type: "image/png" });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    cropToSquareMock.mockResolvedValueOnce(cropped);

    renderWithClient(
      <SquareLogoCropDialog
        file={file}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    await screen.findByTestId("cropper-stub");
    fireEvent.click(screen.getByTestId("square-logo-crop-confirm"));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(cropped);
    });
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("short-circuits SVG files via fitImageIntoSquare without rendering the cropper", async () => {
    const file = new File(["<svg/>"], "v.svg", { type: "image/svg+xml" });
    const normalized = new File(["<svg/>"], "v.svg", {
      type: "image/svg+xml",
    });
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    fitImageIntoSquareMock.mockResolvedValueOnce(normalized);

    renderWithClient(
      <SquareLogoCropDialog
        file={file}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledWith(normalized);
    });
    expect(fitImageIntoSquareMock).toHaveBeenCalledWith(file);
    expect(toastMock).not.toHaveBeenCalled();
  });
});
