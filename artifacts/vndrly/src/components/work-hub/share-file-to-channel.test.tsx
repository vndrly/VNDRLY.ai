import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/components/brand-pill-button", () => ({ default: ({ children, tone, ...props }: any) => <button {...props}>{children}</button> }));
import { ShareFileToChannel } from "./share-file-to-channel";
it("requires an explicit share, excludes chats and other companies, and reports the destination", async () => {
  const share = vi.fn().mockResolvedValue({});
  render(<ShareFileToChannel source={{ id: "doc", orgType: "vendor", orgId: 1, data: { channelId: "chat" } }} channels={[
    { id: "gate", name: "Main Gate", contextKind: "gate", ownerOrgType: "vendor", ownerOrgId: 1 },
    { id: "chat", name: "Private chat", contextKind: "chat", ownerOrgType: "vendor", ownerOrgId: 1 },
    { id: "foreign", name: "Other company", contextKind: "gate", ownerOrgType: "vendor", ownerOrgId: 2 },
  ]} onShare={share} />);
  fireEvent.click(screen.getByText("Share to channel"));
  expect(screen.queryByRole("option", { name: "Private chat" })).toBeNull();
  expect(screen.queryByRole("option", { name: "Other company" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Share file to channel"), { target: { value: "gate" } });
  expect(share).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Share file"));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Main Gate"));
  expect(share).toHaveBeenCalledWith("gate");
});
