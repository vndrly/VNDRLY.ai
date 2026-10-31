import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { MarketplaceRankedVendor } from "@workspace/api-client-react";
import VendorComparisonCard from "./VendorComparisonCard";
import i18n from "@/lib/i18n";

const vendor: MarketplaceRankedVendor = {
  vendorId: 2, vendorName: "Gate company", capabilityId: 4, capabilityName: "Gatekeeping", canonicalServiceId: 8,
  matchExplanation: "Matched gatekeeping service", offer: null, quoteRequired: true, offerable: false,
  eligibility: { eligible: true, reasonCodes: [], facts: { distanceMiles: 10, radiusMiles: 100, availableCapacity: 2, requiredCapacity: 1, missingCredentials: [] } },
  rating: null, ratingStatus: "not_yet_rated", reviewCount: 0, safety: null, safetyStatus: "not_yet_rated",
  completedJobs: 0, onTimeRate: null, priorPartnerJobs: 0, complianceCurrent: true, relationshipStatus: null, weightedScore: 0, factors: [],
};
beforeEach(async () => { await i18n.changeLanguage("en"); });
it("shows an unpriced service match, allows requesting a quote and prevents an award", () => {
  const request = vi.fn();
  render(<VendorComparisonCard vendor={vendor} compared={false} onCompare={() => {}} onOffer={vi.fn()} onDetails={() => {}} onQuote={request} />);
  expect(screen.getByText("Gate company")).toBeTruthy();
  expect(screen.getByText("Quote required")).toBeTruthy();
  const quote = screen.getByRole("button", { name: "Request quote" });
  expect((quote as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(quote);
  expect(request).toHaveBeenCalledOnce();
  expect((screen.getByRole("button", { name: /prepare.*offer/i }) as HTMLButtonElement).disabled).toBe(true);
});
it("keeps a restricted service match visible but blocks the quote action", () => {
  render(<VendorComparisonCard vendor={{ ...vendor, eligibility: { ...vendor.eligibility, eligible: false, reasonCodes: ["RELATIONSHIP_RESTRICTED"] } }} compared={false} onCompare={() => {}} onOffer={() => {}} onDetails={() => {}} onQuote={() => {}} />);
  expect((screen.getByRole("button", { name: "Request quote" }) as HTMLButtonElement).disabled).toBe(true);
});
