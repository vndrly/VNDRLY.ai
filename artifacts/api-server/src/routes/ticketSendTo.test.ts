import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

const listSendToRecipientsMock = vi.fn();
const actorCanSendToTicketMock = vi.fn();
const listSendToRecipientsForContextMock = vi.fn();
const actorCanSendToContextMock = vi.fn();

vi.mock("../lib/ticket-send-to", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ticket-send-to")>();
  return {
    ...actual,
    listSendToRecipients: (...args: unknown[]) => listSendToRecipientsMock(...args),
    actorCanSendToTicket: (...args: unknown[]) => actorCanSendToTicketMock(...args),
    listSendToRecipientsForContext: (...args: unknown[]) =>
      listSendToRecipientsForContextMock(...args),
    actorCanSendToContext: (...args: unknown[]) => actorCanSendToContextMock(...args),
  };
});

function dbTerminal(rows: unknown[]) {
  const done = () => Promise.resolve(rows);
  const orderBy = () => ({ limit: done });
  const where = () => ({ orderBy, ...done, then: done().then.bind(done()) });
  return {
    innerJoin: () => ({ where }),
    where,
    orderBy,
    limit: done,
    then: done().then.bind(done()),
  };
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  return {
    db: {
      select: () => ({
        from: () => dbTerminal([
          {
            id: 9001,
            userId: 42,
            link: "/tickets/55",
          },
        ]),
      }),
    },
    notificationsTable: tableTag("notifications"),
    vendorPeopleTable: tableTag("vendorPeople"),
    assistantMessagesTable: tableTag("assistantMessages"),
    assistantConversationsTable: tableTag("assistantConversations"),
  };
});

const partnerCookie = buildTestCookie({
  userId: 42,
  role: "partner",
  partnerId: 7,
  vendorId: null,
  displayName: "Exxon User",
});

describe("GET /api/notifications/:id/send-to-recipients", () => {
  let app: express.Express;

  beforeEach(async () => {
    listSendToRecipientsMock.mockReset();
    actorCanSendToTicketMock.mockReset();
    listSendToRecipientsForContextMock.mockReset();
    actorCanSendToContextMock.mockReset();
    actorCanSendToTicketMock.mockResolvedValue(true);
    actorCanSendToContextMock.mockResolvedValue(true);
    listSendToRecipientsMock.mockResolvedValue([
      {
        id: "on_ticket",
        recipients: [
          {
            userId: 99,
            displayName: "Bob",
            email: null,
            group: "on_ticket",
            roleLabel: "Acme · on this ticket",
            headline: "Bob",
            detail: "Acme · on this ticket",
          },
        ],
      },
    ]);

    const { default: ticketSendToRouter } = await import("./ticketSendTo");
    app = express();
    app.use(cookieParser());
    app.use(ticketSendToRouter);
    attachTestErrorMiddleware(app);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns recipient groups for a ticket-linked notification", async () => {
    const res = await request(app)
      .get("/notifications/9001/send-to-recipients")
      .set("Cookie", partnerCookie);

    expectStatus(res, 200);
    expect(res.body).toEqual({
      ticketId: 55,
      groups: [
        {
          id: "on_ticket",
          recipients: [
            {
              userId: 99,
              displayName: "Bob",
              email: null,
              group: "on_ticket",
              roleLabel: "Acme · on this ticket",
              headline: "Bob",
              detail: "Acme · on this ticket",
            },
          ],
        },
      ],
    });
    expect(actorCanSendToTicketMock).toHaveBeenCalledWith(
      55,
      expect.objectContaining({ userId: 42, role: "partner", partnerId: 7 }),
    );
  });

  it("returns 403 when actor cannot send from the ticket", async () => {
    actorCanSendToTicketMock.mockResolvedValue(false);

    const res = await request(app)
      .get("/notifications/9001/send-to-recipients")
      .set("Cookie", partnerCookie);

    expectStatus(res, 403);
    expect(res.body.code).toBe("send_to.forbidden");
  });
});

describe("GET /api/assistant/messages/:id/send-to-recipients", () => {
  let app: express.Express;

  beforeEach(async () => {
    listSendToRecipientsForContextMock.mockReset();
    actorCanSendToContextMock.mockReset();
    actorCanSendToContextMock.mockResolvedValue(true);
    listSendToRecipientsForContextMock.mockResolvedValue([
      {
        id: "partner_poc_ap",
        recipients: [
          {
            userId: 88,
            displayName: "AP User",
            email: null,
            group: "partner_poc_ap",
            roleLabel: "Partner AP",
            headline: "AP User",
            detail: "Exxon · Partner AP",
          },
        ],
      },
    ]);

    const { default: ticketSendToRouter } = await import("./ticketSendTo");
    app = express();
    app.use(cookieParser());
    app.use(ticketSendToRouter);
    attachTestErrorMiddleware(app);
  });

  it("returns org-scoped recipient groups for an AskV message", async () => {
    const { db } = await import("@workspace/db");
    vi.spyOn(db, "select").mockReturnValue({
      from: () =>
        dbTerminal([
          {
            id: 501,
            role: "assistant",
            ownerUserId: 42,
          },
        ]),
    } as never);

    const res = await request(app)
      .get("/assistant/messages/501/send-to-recipients")
      .set("Cookie", partnerCookie);

    expectStatus(res, 200);
    expect(res.body.ticketId).toBeNull();
    expect(res.body.groups).toHaveLength(1);
    expect(actorCanSendToContextMock).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ userId: 42, role: "partner", partnerId: 7 }),
    );
    expect(listSendToRecipientsForContextMock).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ userId: 42, role: "partner", partnerId: 7 }),
    );
  });
});
