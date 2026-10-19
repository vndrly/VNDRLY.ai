import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/lib/i18n";
const user = vi.hoisted(() => ({ role: "admin" }));
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user }) }));
vi.mock("@/hooks/use-brand", () => ({
  useBrand: () => ({ brand: { primary: "#3260CD" } }),
}));
import AdminServiceMappings from "./admin-service-mappings";
import CatalogHealthPage from "./catalog-health";

const service = {
  id: 5,
  code: "gate_security",
  name: "Gate security",
  category: "Security",
  definition: "Control entry",
  active: true,
  aliases: [],
};
const mapping = {
  id: 1,
  subjectType: "partner_work_type",
  subjectId: 21,
  status: "review_required",
  confidence: 0.74,
  evidenceSummary: "Visitor logs and controlled entry",
  evidence: { features: ["logs"] },
  modelVersion: "model:v1",
  subject: { name: "Gatekeeping", description: "Log visitors" },
  canonicalService: service,
  canonicalServiceId: 5,
};
let writes: { path: string; body: unknown }[];
let reviewed: boolean;
let readsAfterWrite: number;
let pendingClassification: boolean;
function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AdminServiceMappings />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  user.role = "admin";
  writes = [];
  reviewed = false;
  readsAfterWrite = 0;
  pendingClassification = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, options?: RequestInit) => {
      if (options?.method && options.method !== "GET") {
        writes.push({
          path: String(path),
          body: options.body ? JSON.parse(String(options.body)) : null,
        });
        reviewed = !pendingClassification;
        return {
          ok: true,
          json: async () =>
            pendingClassification
              ? {
                  status: "pending",
                  mapping: null,
                  currentMapping: null,
                  retryable: true,
                }
              : { mapping: { ...mapping, status: "active" } },
        };
      }
      if (reviewed) readsAfterWrite++;
      return {
        ok: true,
        json: async () =>
          String(path).includes("canonical-services")
            ? { items: [service], total: 1 }
            : { items: reviewed ? [] : [mapping], total: reviewed ? 0 : 1 },
      };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("admin service mapping review page", () => {
  it("denies non-admins without requesting review data", () => {
    user.role = "vendor";
    mount();
    expect(screen.getByText("Admin role required.")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("makes the review queue discoverable from catalog health", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { enabled: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <CatalogHealthPage />
      </QueryClientProvider>,
    );
    expect(
      screen
        .getByRole("link", { name: "Service mapping review" })
        .getAttribute("href"),
    ).toContain("/admin/service-mappings");
  });
  it("shows subject text, concept, confidence, evidence, and classifier revision", async () => {
    mount();
    expect(await screen.findByText("Gatekeeping")).toBeTruthy();
    expect(screen.getByText("74%")).toBeTruthy();
    expect(screen.getByText("Visitor logs and controlled entry")).toBeTruthy();
    expect(screen.getByText("model:v1")).toBeTruthy();
  });
  it("approves with a review reason and refreshes canonical readback", async () => {
    mount();
    await screen.findByText("Gatekeeping");
    fireEvent.change(screen.getByLabelText("Review reason"), {
      target: { value: "Confirmed scope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryByText("Gatekeeping")).toBeNull());
    expect(writes).toEqual([
      {
        path: "/api/admin/service-mappings/1/review",
        body: { action: "approve", reason: "Confirmed scope" },
      },
    ]);
    expect(readsAfterWrite).toBeGreaterThanOrEqual(2);
  });
  it("requires confirmation before remapping and lets the admin cancel", async () => {
    mount();
    await screen.findByText("Gatekeeping");
    fireEvent.change(screen.getByLabelText("Review reason"), {
      target: { value: "Corrected concept" },
    });
    fireEvent.change(screen.getByLabelText("Canonical service"), {
      target: { value: "5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remap" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Remap" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({
      action: "remap",
      canonicalServiceId: 5,
      reason: "Corrected concept",
    });
  });
  it("requires confirmation before archiving a canonical concept", async () => {
    mount();
    await screen.findByText("Gatekeeping");
    fireEvent.click(
      screen.getByRole("button", { name: "Archive Gate security" }),
    );
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(writes).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(writes[0].path).toBe("/api/admin/canonical-services/5"),
    );
  });
  it("surfaces failed writes and retains the review item", async () => {
    mount();
    await screen.findByText("Gatekeeping");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ code: "service_mapping.stale_review" }),
      })),
    );
    fireEvent.change(screen.getByLabelText("Review reason"), {
      target: { value: "Verified" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Gatekeeping")).toBeTruthy();
  });

  it("requires a reason before submitting a review", async () => {
    mount();
    await screen.findByText("Gatekeeping");
    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Remap" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("rejects a proposal with its reason and reads the updated queue", async () => {
    mount();
    await screen.findByText("Gatekeeping");
    fireEvent.change(screen.getByLabelText("Review reason"), {
      target: { value: "Operationally different" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByText("No mappings awaiting review.");
    expect(writes[0].body).toEqual({
      action: "reject",
      reason: "Operationally different",
    });
  });

  it("adds reviewed vocabulary to the selected canonical concept", async () => {
    mount();
    await screen.findByText("Gatekeeping");
    fireEvent.change(screen.getByLabelText("Reviewed alias"), {
      target: { value: "Gate Services" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add alias" }));
    await screen.findByText("Saved and refreshed from the server.");
    expect(writes[0]).toEqual({
      path: "/api/admin/canonical-services/5/aliases",
      body: { alias: "Gate Services", provenance: "reviewed_ai" },
    });
  });

  it("displays retryable reclassification without dropping existing review evidence", async () => {
    mount();
    await screen.findByText("Gatekeeping");
    pendingClassification = true;
    fireEvent.click(screen.getByRole("button", { name: "Reclassify" }));
    expect(
      await screen.findByText(
        "Classification is pending retry. Existing mappings remain available.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Gatekeeping")).toBeTruthy();
    expect(screen.getByText("model:v1")).toBeTruthy();
    expect(writes[0].path).toBe(
      "/api/admin/service-subjects/partner_work_type/21/reclassify",
    );
  });
});
