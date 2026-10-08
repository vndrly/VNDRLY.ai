import { describe, expect, it } from "vitest";
import { authorizeVConnection, parseVConnectionSelection } from "./cooperative-v-connections";

describe("explicit V external connection boundary", () => {
  const actor = { userId: 7, vendorId: 10, role: "vendor", membershipRole: "admin" };
  const company = { id: "35c34a3c-ef90-459d-9a4b-e980ec0c8a12", ownerOrgType: "vendor", ownerOrgId: 10, provider: "microsoft-365", capabilities: ["calendar.read"], status: "connected", revokedAt: null, createdById: 8 };
  it("requires exact explicitly selected company connection and current capability", () => {
    const selection = parseVConnectionSelection({ connectionId: company.id, scope: "company" })!;
    expect(authorizeVConnection(actor, company, selection, "calendar.read")).toMatchObject({ scope: "company", connectionId: company.id });
    expect(() => authorizeVConnection(actor, { ...company, ownerOrgId: 11 }, selection, "calendar.read")).toThrow("connection");
    expect(() => authorizeVConnection(actor, { ...company, capabilities: [] }, selection, "calendar.read")).toThrow("scope");
    expect(() => authorizeVConnection(actor, { ...company, revokedAt: new Date() }, selection, "calendar.read")).toThrow("connection");
    expect(() => authorizeVConnection(actor, company, { ...selection, connectionId: "another" }, "calendar.read")).toThrow("connection");
  });
  it("personal grants belong to the worker and require fresh explicit personal permission", () => {
    const personal = { ...company, ownerOrgType: "user", ownerOrgId: 7, createdById: 7 };
    const selection = parseVConnectionSelection({ connectionId: company.id, scope: "personal", personalPermission: true })!;
    expect(authorizeVConnection(actor, personal, selection, "calendar.read")).toMatchObject({ scope: "personal", personalContentMayBeSavedToCompany: false });
    expect(() => authorizeVConnection(actor, personal, { ...selection, personalPermission: false }, "calendar.read")).toThrow("permission");
    expect(() => authorizeVConnection({ ...actor, userId: 8 }, personal, selection, "calendar.read")).toThrow("connection");
    expect(() => authorizeVConnection(actor, company, selection, "calendar.read")).toThrow("connection");
  });
  it("does not infer connection authority or personal permissions from ChatGPT claims", () => {
    expect(parseVConnectionSelection(undefined)).toBeNull();
    expect(() => parseVConnectionSelection({ connectionId: company.id, scope: "personal", chatgptSubscription: true })).toThrow();
    expect(() => parseVConnectionSelection({ connectionId: company.id, scope: "company", encryptedCredentials: "model-supplied" })).toThrow();
  });
});
