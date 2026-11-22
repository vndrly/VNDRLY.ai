import { useState } from "react";
import StatusShield from "@/components/status-shield";
import { ProfileActionButton } from "@/components/gate-profile-chrome";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import SafetyReportPage from "@/pages/safety-report";

export function GateIncidentReport({ siteId, sites }: { siteId: string; sites: {id:number;name:string}[] }) {
  const [open, setOpen] = useState(false);
  return <>
    <ProfileActionButton className="ml-auto shrink-0" onClick={() => setOpen(true)}>
      <StatusShield status="red" label="" />Report an incident
    </ProfileActionButton>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="right" modalChrome className="!w-full sm:!max-w-xl">
        <SheetHeader><SheetTitle>Report an incident</SheetTitle>
          <SheetDescription>Submit a safety report to start the safety response process.</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto p-4">
          {open && <SafetyReportPage embedded initialSiteId={siteId} siteOptions={sites} onSubmitted={() => setOpen(false)} />}
        </div>
      </SheetContent>
    </Sheet>
  </>;
}
