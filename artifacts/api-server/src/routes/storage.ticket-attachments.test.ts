import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import router from "./storage";

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  session: null as Row | null,
  rows: {} as Record<string, Row[]>,
  object: null as Row | null,
  deleteObject: vi.fn(),
}));
vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => state.session,
}));
vi.mock("../lib/objectStore", () => ({
  UPLOAD_ROUTE: "/storage/upload",
  getObjectStore: () => ({
    getObject: async () => state.object,
    deleteObject: state.deleteObject,
  }),
}));
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (column: string, value: unknown) => ({ column, value }),
  isNull: (column: string) => ({ column, value: null }),
  arrayContains: (column: string, values: unknown[]) => ({
    column,
    values,
    array: true,
  }),
  and: (...conditions: unknown[]) => ({ conditions }),
  or: (...conditions: unknown[]) => ({ conditions, or: true }),
}));
vi.mock("@workspace/db", () => {
  const names = [
    "visits",
    "sites",
    "assignments",
    "notes",
    "tickets",
    "people",
    "crew",
    "workHubFiles",
  ];
  const tables = Object.fromEntries(
    names.map((name) => [
      name,
      new Proxy(
        { tableName: name },
        {
          get: (target, key) =>
            key === "tableName" ? target.tableName : String(key),
        },
      ),
    ]),
  );
  function matches(row: Row, condition: Row): boolean {
    if (!condition) return true;
    if (condition.conditions)
      return condition.or
        ? condition.conditions.some((c: Row) => matches(row, c))
        : condition.conditions.every((c: Row) => matches(row, c));
    if (condition.array)
      return condition.values.every((value: unknown) =>
        row[condition.column]?.includes(value),
      );
    return (row[condition.column] ?? null) === condition.value;
  }
  return {
    db: {
      select: () => ({
        from: (table: Row) => {
          let condition: Row;
          const rows = () =>
            state.rows[table.tableName].filter((row) =>
              matches(row, condition),
            );
          const query: Row = {
            leftJoin: () => query,
            where: (value: Row) => {
              condition = value;
              return query;
            },
            limit: async (count: number) => rows().slice(0, count),
            then: (
              resolve: (value: Row[]) => unknown,
              reject: (error: unknown) => unknown,
            ) => Promise.resolve(rows()).then(resolve, reject),
          };
          return query;
        },
      }),
    },
    siteVisitsTable: tables.visits,
    siteLocationsTable: tables.sites,
    siteWorkAssignmentsTable: tables.assignments,
    ticketNoteLogsTable: tables.notes,
    ticketsTable: tables.tickets,
    vendorPeopleTable: tables.people,
    ticketCrewTable: tables.crew,
    workHubFilesTable: tables.workHubFiles,
  };
});
const objectPath = "/objects/uploads/00000000-0000-4000-8000-000000000001";
const url = `/storage${objectPath}`;
function app() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}
beforeEach(() => {
  state.session = { userId: 20, role: "vendor", vendorId: 22 };
  state.object = {
    body: Buffer.from("photo"),
    contentType: "image/jpeg",
    size: 5,
    acl: { owner: "10", visibility: "private" },
  };
  state.rows = {
    visits: [],
    sites: [],
    assignments: [],
    notes: [],
    tickets: [],
    people: [],
    crew: [],
    workHubFiles: [],
  };
  state.rows.notes.push({
    id: 1,
    ticketId: 1,
    createdById: 10,
    content: `[photo] ${objectPath}`,
    deletedAt: null,
  });
  state.rows.tickets.push({
    id: 1,
    vendorId: 22,
    partnerId: 33,
    fieldEmployeeId: 7,
    foremanUserId: 11,
    actingForemanUserId: 12,
  });
  state.deleteObject.mockReset();
});
describe("private ticket photo authorization", () => {
  it("keeps upload owners authorized before attachment and denies unrelated sessions", async () => {
    state.rows.notes = [];
    state.session = { userId: 10, role: "field_employee" };
    const response = await request(app()).get(url).expect(200);
    expect(response.headers["cache-control"]).toBe("private, max-age=3600");
    state.session = { userId: 20, role: "vendor", vendorId: 22 };
    await request(app()).get(url).expect(403);
    state.session = null;
    await request(app()).get(url).expect(403);
  });
  it("uses ticket tenancy for vendor, partner, and admin access", async () => {
    for (const session of [
      { userId: 20, role: "vendor", vendorId: 22 },
      { userId: 21, role: "partner", partnerId: 33 },
      { userId: 22, role: "admin" },
    ]) {
      state.session = session;
      await request(app()).get(url).expect(200);
    }
    for (const session of [
      { userId: 20, role: "vendor", vendorId: 44 },
      { userId: 21, role: "partner", partnerId: 44 },
      { userId: 20, role: "vendor" },
      { userId: 20, role: "unknown" },
    ]) {
      state.session = session;
      await request(app()).get(url).expect(403);
    }
  });
  it("uses active field assignment, foreman, and current crew permissions", async () => {
    state.rows.people.push({
      id: 7,
      userId: 20,
      vendorId: 22,
      isActive: true,
      deletedAt: null,
    });
    state.session = { userId: 20, role: "field_employee" };
    await request(app()).get(url).expect(200);
    state.rows.people[0].id = 8;
    await request(app()).get(url).expect(403);
    state.rows.crew.push({ ticketId: 1, employeeId: 8, removedAt: null });
    await request(app()).get(url).expect(200);
    state.rows.crew[0].removedAt = new Date();
    await request(app()).get(url).expect(403);
    state.rows.tickets[0].actingForemanUserId = 20;
    await request(app()).get(url).expect(200);
    state.rows.people[0].isActive = false;
    await request(app()).get(url).expect(403);
    state.rows.people[0].isActive = true;
    state.rows.people[0].vendorId = 44;
    await request(app()).get(url).expect(403);
  });
  it("cannot share another uploader's private object by forging a photo note", async () => {
    state.rows.notes[0].createdById = 20;
    await request(app()).get(url).expect(403);
    state.rows.notes[0].createdById = null;
    await request(app()).get(url).expect(403);
    state.rows.notes[0].createdById = 10;
    state.object!.acl = null;
    await request(app()).get(url).expect(403);
  });
  it("requires an exact active reference and does not grant all private objects to admins", async () => {
    for (const content of [
      `other text ${objectPath}`,
      `[photo] ${objectPath}/other`,
      `[photo] ${objectPath}?other=1`,
    ]) {
      state.rows.notes[0].content = content;
      await request(app()).get(url).expect(403);
    }
    state.rows.notes[0].content = `[photo] ${objectPath}`;
    state.rows.notes[0].deletedAt = new Date();
    await request(app()).get(url).expect(403);
    state.session = { userId: 20, role: "admin" };
    await request(app()).get(url).expect(403);
  });
  it("also supports exact attachment array entries and API proxy paths", async () => {
    state.rows.notes[0].content = "Photo from the field";
    state.rows.notes[0].attachments = [`${objectPath}/other`];
    await request(app()).get(url).expect(403);
    state.rows.notes[0].attachments = [objectPath];
    await request(app()).get(url).expect(200);
    state.rows.notes[0].attachments = [`/api/storage${objectPath}`];
    await request(app()).get(url).expect(200);
  });
  it("preserves attached ticket evidence during owner cleanup", async () => {
    state.session = { userId: 10, role: "field_employee" };
    await request(app())
      .delete("/storage/uploads")
      .send({ objectPath })
      .expect(409);
    expect(state.deleteObject).not.toHaveBeenCalled();
    state.rows.notes = [];
    await request(app())
      .delete("/storage/uploads")
      .send({ objectPath })
      .expect(204);
    expect(state.deleteObject).toHaveBeenCalledWith(objectPath);
  });
});

