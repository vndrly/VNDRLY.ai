import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "./alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./dialog";

let resolvedTheme: "light" | "dark" = "light";

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ resolved: resolvedTheme }),
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetPartner: () => ({ data: null }),
  useGetVendor: () => ({ data: null }),
  getGetPartnerQueryKey: () => [],
  getGetVendorQueryKey: () => [],
}));

afterEach(() => {
  cleanup();
  resolvedTheme = "light";
});

describe("always-dark modal theme contract", () => {
  for (const pageTheme of ["light", "dark"] as const) {
    it(`keeps standard dialogs dark on ${pageTheme} pages with a light body`, () => {
      resolvedTheme = pageTheme;
      render(
        <Dialog open>
          <DialogContent>
            <DialogTitle>Standard modal</DialogTitle>
            <DialogDescription>Standard description</DialogDescription>
          </DialogContent>
        </Dialog>,
      );

      expect(screen.getByRole("dialog").className).toContain("bg-[#3a3d42]");
      const body = screen.getByTestId("modal-body");
      expect(body.className).toContain("bg-[#d1d5db]");
      expect(body.style.colorScheme).toBe("light");
      expect(screen.getByTestId("modal-accent-header").style.backgroundImage).toContain(
        "VNDRLY_Header_Blur_Dark",
      );
    });

    it(`keeps confirmation dialogs dark on ${pageTheme} pages with a light body`, () => {
      resolvedTheme = pageTheme;
      render(
        <AlertDialog open>
          <AlertDialogContent>
            <AlertDialogTitle>Confirmation modal</AlertDialogTitle>
            <AlertDialogDescription>Confirmation description</AlertDialogDescription>
          </AlertDialogContent>
        </AlertDialog>,
      );

      expect(screen.getByRole("alertdialog").className).toContain("bg-[#3a3d42]");
      const body = screen.getByTestId("modal-body");
      expect(body.className).toContain("bg-[#d1d5db]");
      expect(body.style.colorScheme).toBe("light");
      expect(screen.getByTestId("modal-accent-header").style.backgroundImage).toContain(
        "VNDRLY_Header_Blur_Dark",
      );
    });
  }
});
