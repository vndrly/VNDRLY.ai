import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { DEFAULT_BRAND } from "@/hooks/use-brand";
import { brandImagePillSrc } from "@/components/png-pill-rollover";
import { pickLoginSquareActive } from "@/lib/login-button-palette";
import { CalendarTimeGrid, calendarViewDays, localDateKey } from "./calendar-views";
describe("Work Hub calendar ranges", () => {
  it("drills from a week into a clicked day and toggles that day back to its week", () => {
    function CalendarHarness() {
      const [selectedDay, setSelectedDay] = useState("2026-09-16");
      return <CalendarTimeGrid selectedDay={selectedDay} items={[]} onSelectDay={setSelectedDay} />;
    }

    render(<CalendarHarness />);

    fireEvent.click(screen.getByRole("button", { name: /Thu, Sep 17/ }));
    expect((screen.getByLabelText("Calendar view") as HTMLSelectElement).value).toBe("day");
    expect(screen.queryByRole("button", { name: /Wed, Sep 16/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Thu, Sep 17/ }));
    expect((screen.getByLabelText("Calendar view") as HTMLSelectElement).value).toBe("week");
    expect(screen.queryByRole("button", { name: /Wed, Sep 16/ })).not.toBeNull();
  });

  it("keeps day view on the chosen local day", () => {
    expect(calendarViewDays("2026-09-09", "day").map(localDateKey)).toEqual(["2026-09-09"]);
  });
  it("includes adjoining months in a full Sunday-start week", () => {
    expect(calendarViewDays("2026-10-01", "week").map(localDateKey)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]);
  });
  it("does not truncate a week at the year boundary", () => {
    const days = calendarViewDays("2027-01-01", "week").map(localDateKey);
    expect(days[0]).toBe("2026-12-27"); expect(days[6]).toBe("2027-01-02");
  });
  it("renders branded navigation, white selectors, and readable branded weekday tiles", () => {
    render(<CalendarTimeGrid selectedDay="2026-09-16" items={[]} onSelectDay={() => undefined} />);

    const brandPill = brandImagePillSrc(DEFAULT_BRAND.primary, DEFAULT_BRAND.name);
    const today = screen.getByRole("button", { name: "Today" });
    expect([...today.querySelectorAll("img")].some((image) => image.getAttribute("src") === brandPill)).toBe(true);
    for (const name of ["Previous week", "Next week"]) {
      expect(screen.getByRole("button", { name }).querySelector('[data-testid="sphere-back-circle"]')).not.toBeNull();
    }

    for (const name of ["Calendar view", "Event type"]) {
      const select = screen.getByLabelText(name);
      expect(select.className).toContain("bg-white");
      expect(select.className).toContain("rounded-full");

      expect(select.className).toContain("hub-branded-select");
      expect(select.style.colorScheme).toBe("light");
      expect(select.className).toContain("border-[color:var(--brand-primary)]");
    }

    const sunday = screen.getByRole("button", { name: /Sun, Sep 13/ });
    const weekdayRail = screen.getByTestId("calendar-weekday-rail");
    expect(weekdayRail.className).toContain("bg-gray-400");
    expect(weekdayRail.className).toContain("py-1");
    expect(weekdayRail.className).toContain("border-y-2");
    expect(weekdayRail.className).toContain("border-[color:var(--brand-primary)]");
    expect(sunday.className).toContain("rounded-lg");
    expect(sunday.querySelector(`img[src="${pickLoginSquareActive(DEFAULT_BRAND.primary, DEFAULT_BRAND.name)}"]`)).not.toBeNull();
    expect(sunday.textContent).toContain("Sun, Sep 13");
  });
});

it("labels dispatch-only Fleet placements and displays the driver and billing ticket without claiming worked hours",()=>{
 render(<CalendarTimeGrid selectedDay="2026-10-16" onSelectDay={()=>undefined} items={[{id:"activity",kind:"Fleet Run",title:"Crude haul",startsAt:new Date(2026,9,16,9).toISOString(),endsAt:null,timeBasis:"dispatch_recorded",employeeName:"Bob Villa",linkedTicketId:601,route:"/fleet/runs/activity"}]}/>);
 expect(screen.getByText("Dispatch recorded · no planned time")).toBeTruthy();expect(screen.getByText("Bob Villa")).toBeTruthy();expect(screen.getByText("Ticket #601")).toBeTruthy();expect(screen.getByRole("link",{name:/Crude haul/}).getAttribute("href")).toBe("/fleet/runs/activity");
});
