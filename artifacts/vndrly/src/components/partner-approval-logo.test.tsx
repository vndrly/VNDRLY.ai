import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import PartnerApprovalLogo from "./partner-approval-logo";

describe("PartnerApprovalLogo", () => {
  it("uses the primary brand outline around a partner logo", () => {
    render(
      <PartnerApprovalLogo
        partnerId={566}
        partnerName="Flywheel Energy"
        logoUrl="/flywheel.png"
        squareLogoUrl="/flywheel-square.png"
      />,
    );

    expect(screen.getByTestId("img-partner-row-566").className).toContain(
      "border-[color:var(--brand-primary)]",
    );
  });
});
