import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { attachTestErrorMiddleware } from "../test-utils/route-app";

const state = vi.hoisted(() => ({
  session: null as any,
  enabled: true,
  tables: {} as Record<string, any[]>,
  queries: [] as { table: string; limit: number; returned: number }[],
  channel: {} as any,
  channelDenied: false,
  siteDenied: false,
  channelCalls: [] as unknown[][],
  siteCalls: [] as unknown[][],
}));
vi.mock("../lib/session", () => ({
  getSessionFromRequest: () => state.session,
}));
vi.mock("../work-hub/feature-access", () => ({
  isWorkHubEnabled: async () => state.enabled,
}));
vi.mock("drizzle-orm", () => ({
  eq: (key: string, value: unknown) => (row: any) => row[key] === value,
  and:
    (...predicates: any[]) =>
    (row: any) =>
      predicates.every((p) => p(row)),
}));
vi.mock("@workspace/db", () => {
  const tables = Object.fromEntries(
    [
      "workHubFormInstances",
      "workHubFormTemplates",
      "workHubChecklistInstances",
      "workHubChecklistTemplates",
      "userOrgMemberships",
    ].map((name) => [
      `${name}Table`,
      new Proxy(
        { name },
        {
          get: (table, key: string) => (key === "name" ? table.name : key),
        },
      ),
    ]),
  );
  return {
    ...tables,
    pool: {},
    db: {
      select: () => ({
        from: (table: any) => {
          let predicate = (_row: any) => true;
          let limit = Infinity;
          const query: any = {
            where: (value: any) => {
              predicate = value;
              return query;
            },
            limit: (value: number) => {
              limit = value;
              return query;
            },
            then: (resolve: any, reject: any) =>
              Promise.resolve()
                .then(() => {
                  const rows = (state.tables[table.name] ?? [])
                    .filter(predicate)
                    .slice(0, limit);
                  state.queries.push({
                    table: table.name,
                    limit,
                    returned: rows.length,
                  });
                  return rows;
                })
                .then(resolve, reject),
          };
          return query;
        },
      }),
    },
  };
});
vi.mock("../work-hub/queries", () => ({
  resolveChannelAccess: async (...args: unknown[]) => {
    state.channelCalls.push(args);
    if (state.channelDenied)
      throw Object.assign(new Error("forbidden"), { status: 403 });
    return { channel: state.channel };
  },
}));
vi.mock("../services/gate-change-over", () => ({
  requireChangeOverAccess: async (...args: unknown[]) => {
    state.siteCalls.push(args);
    if (state.siteDenied)
      throw Object.assign(new Error("forbidden"), { status: 403 });
  },
}));

import router from "./workHubRequiredAction";
const app = express();
app.use("/api", router);
attachTestErrorMiddleware(app);
const id = "10000000-0000-4000-8000-000000000001";
const templateId = "20000000-0000-4000-8000-000000000001";
const channelId = "30000000-0000-4000-8000-000000000001";
const endpoint = (kind = "form", subjectId = id) =>
  `/api/work-hub/required-actions/${kind}/${subjectId}`;
beforeEach(() => {
  state.session = {
    userId: 7,
    role: "field_employee",
    vendorId: 11,
    vendorRole: "gatekeeper",
  };
  state.enabled = true;
  state.channelDenied = state.siteDenied = false;
  state.queries = [];
  state.channelCalls = [];
  state.siteCalls = [];
  state.channel = {
    id: channelId,
    ownerOrgType: "vendor",
    ownerOrgId: 11,
    contextKind: "gate",
    contextId: "3",
  };
  state.tables = {
    userOrgMemberships: [{ userId: 7, orgType: "vendor", vendorId: 11 }],
  };
  for (const kind of ["Form", "Checklist"]) {
    state.tables[`workHub${kind}Instances`] = [
      {
        id,
        templateId,
        assigneeUserId: 7,
        channelId,
        definitionSnapshot: [{ label: "Original form" }],
        snapshot: [{ label: "Original checklist" }],
      },
    ];
    state.tables[`workHub${kind}Templates`] = [
      {
        id: templateId,
        name: `Assigned ${kind}`,
        ownerOrgType: "vendor",
        ownerOrgId: 11,
        definition: [{ label: "Revised template" }],
      },
    ];
  }
});

describe.each(["form", "checklist"])("exact assigned %s reader", (kind) => {
  const table = `workHub${kind === "form" ? "Form" : "Checklist"}`;
  it("reads only the assigned exact record with bounded queries regardless of history size", async () => {
    state.tables[`${table}Instances`].unshift(
      ...Array.from({ length: 1500 }, (_, i) => ({
        id: `unrelated-${i}`,
        templateId,
        assigneeUserId: 7,
      })),
    );
    const response = await request(app).get(endpoint(kind));
    expect(response.status).toBe(200);
    expect(response.body.instance.id).toBe(id);
    expect(
      response.body.instance[
        kind === "form" ? "definitionSnapshot" : "snapshot"
      ],
    ).toEqual([
      { label: kind === "form" ? "Original form" : "Original checklist" },
    ]);
    expect(response.body.template).toEqual({
      id: templateId,
      name: `Assigned ${kind === "form" ? "Form" : "Checklist"}`,
    });
    expect(state.queries).toHaveLength(3);
    expect(state.queries.every((q) => q.limit === 1 && q.returned <= 1)).toBe(
      true,
    );
    expect(state.channelCalls).toEqual([
      [state.session, channelId, "channel.read"],
    ]);
    expect(state.siteCalls[0]?.slice(1)).toEqual([state.session, 3]);
  });
  it.each([
    "missing",
    "other assignee",
    "unassigned",
    "other tenant",
    "revoked membership",
    "other member",
    "other membership tenant",
    "channel denied",
    "channel tenant",
    "site denied",
  ])("conceals %s", async (reason) => {
    const instance = state.tables[`${table}Instances`][0];
    if (reason === "missing") state.tables[`${table}Instances`] = [];
    if (reason === "other assignee") instance.assigneeUserId = 8;
    if (reason === "unassigned") instance.assigneeUserId = null;
    if (reason === "other tenant")
      state.tables[`${table}Templates`][0].ownerOrgId = 22;
    if (reason === "revoked membership") state.tables.userOrgMemberships = [];
    if (reason === "other member")
      state.tables.userOrgMemberships[0].userId = 8;
    if (reason === "other membership tenant")
      state.tables.userOrgMemberships[0].vendorId = 22;
    if (reason === "channel denied") state.channelDenied = true;
    if (reason === "channel tenant") state.channel.ownerOrgId = 22;
    if (reason === "site denied") state.siteDenied = true;
    const response = await request(app).get(endpoint(kind));
    expect(response.status).toBe(404);
    expect(response.body).not.toHaveProperty("instance");
    expect(JSON.stringify(response.body)).not.toContain("Assigned");
  });
  it("allows assigned partner records only with the current partner membership", async () => {
    state.session = { userId: 7, role: "partner", partnerId: 33 };
    state.tables[`${table}Templates`][0].ownerOrgType = "partner";
    state.tables[`${table}Templates`][0].ownerOrgId = 33;
    state.tables[`${table}Instances`][0].channelId = null;
    state.tables.userOrgMemberships = [
      { userId: 7, orgType: "partner", partnerId: 33 },
    ];
    expect((await request(app).get(endpoint(kind))).status).toBe(200);
    state.tables.userOrgMemberships = [];
    expect((await request(app).get(endpoint(kind))).status).toBe(404);
  });
  it("does not let platform admin bypass assignment", async () => {
    state.session = { userId: 7, role: "admin" };
    state.tables[`${table}Instances`][0].assigneeUserId = 8;
    expect((await request(app).get(endpoint(kind))).status).toBe(404);
  });
});
it("requires authentication", async () => {
  state.session = null;
  expect((await request(app).get(endpoint())).status).toBe(401);
  expect(state.queries).toEqual([]);
});
it("honors the Work Hub feature gate", async () => {
  state.enabled = false;
  expect((await request(app).get(endpoint())).status).toBe(404);
  expect(state.queries).toEqual([]);
});
it.each([
  ["approval", id],
  ["form", "malformed"],
])("rejects unsupported kind/id %s %s", async (kind, subjectId) => {
  expect((await request(app).get(endpoint(kind, subjectId))).status).toBe(404);
  expect(state.queries).toEqual([]);
});
