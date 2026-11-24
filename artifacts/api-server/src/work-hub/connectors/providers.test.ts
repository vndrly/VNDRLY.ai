import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authorization, config, exchange, scopes, segment } from "./providers";
import { folderCounts, inboxSummary, folders, mailSchema, mime, messages, writeMail, mutateMail } from "./mail";
import { conversations } from "./chat";
const fetchMock = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  for (const p of ["OUTLOOK_COMMS", "MICROSOFT_365", "GOOGLE_MAIL", "SLACK"]) {
    vi.stubEnv(`${p}_CLIENT_ID`, "fixture-client");
    vi.stubEnv(`${p}_CLIENT_SECRET`, "fixture-secret");
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
it("uses offline Gmail consent and PKCE with a bound state", () => {
  const u = new URL(authorization("gmail", "one-time-state", "verifier"));
  expect(u.hostname).toBe("accounts.google.com");
  expect(u.searchParams.get("state")).toBe("one-time-state");
  expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  expect(u.searchParams.get("access_type")).toBe("offline");
});
it("requests Slack user scopes rather than a bot masquerading as a user", () => {
  const u = new URL(authorization("slack", "state", "unused"));
  expect(u.searchParams.get("user_scope")).toContain("chat:write");
  expect(u.searchParams.has("scope")).toBe(false);
});
it("extracts the Slack user grant rather than the bot token", async () => {
  fetchMock.mockResolvedValue(
    response({
      ok: true,
      access_token: "bot-token",
      authed_user: {
        access_token: "user-token",
        scope: scopes.slack.join(","),
      },
    }),
  );
  const result = await exchange("slack", { code: "code", verifier: "unused" });
  expect(result.access).toBe("user-token");
  const [, request] = fetchMock.mock.calls[0];
  expect(request.headers.Authorization).toBe(
    `Basic ${Buffer.from("fixture-client:fixture-secret").toString("base64")}`,
  );
  expect(new URLSearchParams(request.body).has("client_secret")).toBe(false);
});
it("reports Slack's OAuth error code without exposing credentials", async () => {
  fetchMock.mockResolvedValue(response({ ok: false, error: "bad_redirect_uri" }));
  await expect(exchange("slack", { code: "code", verifier: "unused" })).rejects.toThrow("slack bad redirect uri");
});
it("rejects mail header injection", () => {
  expect(
    mailSchema.safeParse({
      to: ["reader@example.com"],
      subject: "hello\r\nBcc: stolen@example.com",
      text: "body",
    }).success,
  ).toBe(false);
});
it("encodes unicode MIME content and attachments", () => {
  const input = mailSchema.parse({
    to: ["reader@example.com"],
    subject: "Résumé",
    text: "café",
    attachments: [
      {
        name: "note.txt",
        type: "text/plain",
        data: Buffer.from("hello").toString("base64"),
      },
    ],
  });
  const decoded = Buffer.from(
    mime(input, "sender@example.com"),
    "base64url",
  ).toString();
  expect(decoded).toContain(Buffer.from("café").toString("base64"));
  expect(decoded).toContain("aGVsbG8=");
  expect(decoded).not.toContain("Subject: Résumé");
});
it("rejects Outlook cursor origin substitution before sending a token", async () => {
  const cursor = Buffer.from(
    "https://attacker.example/v1.0/me/mailFolders/inbox/messages",
  ).toString("base64url");
  await expect(
    messages("outlook", "private-token", "inbox", cursor),
  ).rejects.toThrow("invalid cursor");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("uses Graph paging parameters on the selected Outlook folder", async () => {
  fetchMock
    .mockResolvedValueOnce(response({
      value: [{ id: "first", subject: "First message" }],
      "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders('provider-id')/messages?$top=5&$skip=5",
    }))
    .mockResolvedValueOnce(response({ value: [{ id: "second", subject: "Second message" }] }));
  const first = await messages("outlook", "private-token", "inbox");
  expect(first.items).toHaveLength(1);
  expect(first.next).toBeTruthy();
  const second = await messages("outlook", "private-token", "inbox", first.next);
  expect(second.items).toHaveLength(1);
  const nextUrl = new URL(fetchMock.mock.calls[1][0]);
  expect(nextUrl.pathname).toBe("/v1.0/me/mailFolders/inbox/messages");
  expect(nextUrl.searchParams.get("$skip")).toBe("5");
});
it("rejects Teams cursor substitution", async () => {
  const cursor = Buffer.from("https://attacker.example/v1.0/me/chats").toString(
    "base64url",
  );
  await expect(
    conversations("teams", "private-token", "chats", cursor),
  ).rejects.toThrow("invalid cursor");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("encodes resource identifiers and rejects dot traversal", () => {
  expect(segment("a/b")).toBe("a%2Fb");
  expect(() => segment("..")).toThrow();
});
it("saves a Gmail draft without sending it", async () => {
  fetchMock.mockResolvedValue(response({ id: "draft-1" }));
  await writeMail(
    "gmail",
    "token",
    "sender@example.com",
    mailSchema.parse({ to: [], subject: "unfinished", text: "draft" }),
    true,
  );
  expect(fetchMock.mock.calls[0][0]).toContain("/drafts");
  expect(fetchMock.mock.calls[0][0]).not.toContain("/send");
});
it("replaces Outlook draft attachments without silently duplicating originals", async () => {
  fetchMock
    .mockResolvedValueOnce(response({ isDraft: true }))
    .mockResolvedValueOnce(response({ value: [{ id: "old-attachment" }] }))
    .mockImplementation(async () => response({}));
  await writeMail(
    "outlook",
    "token",
    "sender@example.com",
    mailSchema.parse({
      to: [],
      subject: "draft",
      text: "body",
      draftId: "draft-1",
      attachments: [{ name: "file.txt", type: "text/plain", data: "aGk=" }],
    }),
    true,
  );
  const calls = fetchMock.mock.calls;
  const add = calls.findIndex((c) => c[1].method === "POST");
  const remove = calls.findIndex((c) => c[1].method === "DELETE");
  expect(add).toBeGreaterThan(-1);
  expect(remove).toBeGreaterThan(add);
  expect(calls[remove][0]).toContain("old-attachment");
});

it("isolates a separate Outlook registration from the held Teams tenant", () => {
  vi.stubEnv("MICROSOFT_365_TENANT_ID", "midcon-tenant");
  vi.stubEnv("MICROSOFT_MAIL_TENANT_ID", "");
  vi.stubEnv("OUTLOOK_COMMS_CLIENT_ID", "outlook-client");
  vi.stubEnv("OUTLOOK_COMMS_CLIENT_SECRET", "outlook-secret");
  expect(config("outlook")).toMatchObject({clientId:"outlook-client",clientSecret:"outlook-secret",tenant:"common"});
  expect(config("teams")).toMatchObject({clientId:"fixture-client",tenant:"midcon-tenant"});
});
it("does not mix incomplete Outlook credentials with Teams credentials", () => {
  vi.stubEnv("OUTLOOK_COMMS_CLIENT_ID", "outlook-client");
  vi.stubEnv("OUTLOOK_COMMS_CLIENT_SECRET", "");
  expect(() => config("outlook")).toThrow("outlook registration required");
  expect(config("teams").clientId).toBe("fixture-client");
});
it("never routes Outlook through Teams when Outlook credentials are absent", () => {
  vi.stubEnv("OUTLOOK_COMMS_CLIENT_ID", "");
  vi.stubEnv("OUTLOOK_COMMS_CLIENT_SECRET", "");
  vi.stubEnv("MICROSOFT_365_TENANT_ID", "teams-only-tenant");
  expect(() => authorization("outlook", "state", "verifier")).toThrow("outlook registration required");
  expect(config("teams").tenant).toBe("teams-only-tenant");
});
it("uses the independent Outlook sign-in and email-only permissions", () => {
  vi.stubEnv("MICROSOFT_MAIL_TENANT_ID", "");
  vi.stubEnv("MICROSOFT_365_TENANT_ID", "unrelated-tenant");
  vi.stubEnv("OUTLOOK_COMMS_CLIENT_ID", "outlook-only-client");
  vi.stubEnv("OUTLOOK_COMMS_REDIRECT_URI", "https://vndrly.ai/api/work-hub/connectors/outlook/callback");
  const url = new URL(authorization("outlook", "bound-state", "verifier"));
  expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  expect(url.searchParams.get("client_id")).toBe("outlook-only-client");
  expect(url.searchParams.get("redirect_uri")).toBe("https://vndrly.ai/api/work-hub/connectors/outlook/callback");
  expect(url.searchParams.get("scope")?.split(" ")).toEqual(["offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send"]);
  expect(url.searchParams.get("prompt")).toBe("select_account");
  expect(url.searchParams.get("state")).toBe("bound-state");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
});
it("keeps Gmail and Slack configuration independent of Microsoft", () => {
  vi.stubEnv("MICROSOFT_365_CLIENT_ID", "");
  vi.stubEnv("MICROSOFT_365_CLIENT_SECRET", "");
  expect(config("gmail").clientId).toBe("fixture-client");
  expect(config("slack").clientId).toBe("fixture-client");
});

it("shows only ordered core Gmail folders and user labels", async () => {
  fetchMock.mockResolvedValueOnce(response({ labels: [
    { id: "CATEGORY_SOCIAL", name: "CATEGORY_SOCIAL", type: "system" },
    { id: "Label_1", name: "Projects", type: "user" },
    ...["TRASH", "SPAM", "DRAFT", "SENT", "INBOX", "STARRED", "IMPORTANT", "ALL"].map(id => ({ id, name: id, type: "system" })),
  ] }));
  expect((await folders("gmail", "token")).items.map((f: any) => f.name))
    .toEqual(["Inbox", "Sent", "Drafts", "Junk", "Deleted", "Projects"]);
});
it("loads Gmail list metadata and preserves ordering with bounded concurrency", async () => {
  let active = 0, peak = 0;
  fetchMock.mockImplementation(async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/messages")) return response({ messages: Array.from({length:25}, (_,i)=>({id:String(i)})), nextPageToken: "next" });
    expect(url.searchParams.get("format")).toBe("metadata");
    active++; peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,2));
    active--;
    return response({ id: url.pathname.split("/").pop(), payload: { headers: [{name:"Subject",value:"Sample"}] } });
  });
  const result = await messages("gmail", "token", "INBOX");
  expect(result.items.map((m:any)=>m.id)).toEqual(Array.from({length:25},(_,i)=>String(i)));
  expect(result.next).toBe("next");
  expect(peak).toBe(10);
});

it("gets real inbox totals independently of unread and page size", async () => {
 fetchMock.mockResolvedValueOnce(response({messagesTotal:432,messagesUnread:12}));
 expect(await inboxSummary("gmail","token")).toEqual({total:432,unread:12});
 expect(String(fetchMock.mock.calls[0][0])).toContain("/labels/INBOX");
 fetchMock.mockResolvedValueOnce(response({totalItemCount:987,unreadItemCount:7}));
 expect(await inboxSummary("outlook","token")).toEqual({total:987,unread:7});
});

it("requests only five summaries for the first Gmail page",async()=>{
 fetchMock.mockResolvedValueOnce(response({messages:[]}));
 await messages("gmail","token","INBOX");
 expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("maxResults")).toBe("5");
 fetchMock.mockResolvedValueOnce(response({messages:[]}));
 await messages("gmail","token","INBOX","next");
 expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("maxResults")).toBe("25");
});

it("returns total folder messages including zero, not unread counts",async()=>{
 fetchMock.mockImplementation(async(url:string)=>response(url.endsWith("/labels")?{labels:[{id:"INBOX",name:"INBOX",type:"system"},{id:"SENT",name:"SENT",type:"system"}]}:url.endsWith("/INBOX")?{messagesTotal:42,messagesUnread:3}:{messagesTotal:0,messagesUnread:0}));
 expect(await folderCounts("gmail","fixture-token")).toEqual({INBOX:42,SENT:0});
 fetchMock.mockResolvedValue(response({value:[{id:"inbox",displayName:"Inbox",totalItemCount:12,unreadItemCount:2}]}));
 expect(await folderCounts("outlook","fixture-token")).toEqual({inbox:12});
});

it("persists Gmail stars and removes the source folder when moving",async()=>{
 fetchMock.mockImplementation(async()=>response({}));
 await mutateMail("gmail","fixture-token","one","star");
 expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({addLabelIds:["STARRED"],removeLabelIds:[]});
 await mutateMail("gmail","fixture-token","one","move","Label_to","Label_from");
 expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({addLabelIds:["Label_to"],removeLabelIds:["Label_from"]});
});
it("persists Outlook favorites as message flags",async()=>{
 fetchMock.mockImplementation(async()=>response({}));
 await mutateMail("outlook","fixture-token","one","star");
 expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({flag:{flagStatus:"flagged"}});
});
