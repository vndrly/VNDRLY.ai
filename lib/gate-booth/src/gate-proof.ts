export type TicketGateProof = {
  ticketId: number;
  visits: {
    id: number;
    siteId: number;
    siteName: string;
    gateName: string | null;
    checkInTime: string;
    checkOutTime: string | null;
    admissionStatus: string | null;
    capture: {
      images: {
        objectPath: string;
        originalPath: string;
        kind: string;
        capturedAt: string;
        phase?: "entry" | "exit";
      }[];
      receivedAt: string;
      recordedByUserId: number;
    } | null;
  }[];
};
