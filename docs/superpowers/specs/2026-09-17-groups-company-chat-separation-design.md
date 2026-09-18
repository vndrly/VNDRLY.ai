# Groups and Company Chat Separation Design

## Status

Approved in conversation on September 17, 2026.

## Goal

Replace the ambiguous combined **Crews & Channels** experience with two focused surfaces:

1. **Groups** manages reusable operational groups and their membership.
2. **{Company Name} Chat** owns every conversation, invitation, and message flow.

The change must preserve the existing secure collaboration data model, conversation history, group ownership safeguards, audit behavior, and organization isolation.

## Terminology

- User-facing **crew** becomes **group** throughout these two surfaces.
- User-facing **channel** becomes **conversation** or **chat**.
- Backend route and table names may retain `crew` and `channel`; this is an interface separation, not a destructive data migration.
- The chat page title is derived from the active organization brand, for example **MidCon Solutions Chat**.

## Navigation and Page Boundaries

### Groups page

The existing `/work-hub/channels` route becomes the Groups page and navigation label. It contains one full-width management card and no conversation list, selected-conversation workspace, message composer, notes, files, or channel controls.

The Groups page supports:

- create a group;
- select a group;
- rename a group;
- list its members;
- add a member;
- promote a member to owner;
- demote an owner to member;
- remove a member;
- archive a group;
- delete a group.

At least one owner must remain. Existing server enforcement remains authoritative and the UI explains a rejected last-owner removal.

The group editor no longer lists or creates channels. Archive and Delete remain separate, explicit actions.

### Company Chat page

The existing `/work-hub/chat` route becomes the only conversation workspace. Its title is `{active organization name} Chat`.

It retains:

- conversation search;
- unread, favorites, and drafts filtering;
- conversation history;
- message composition and editing;
- threads, reactions, notes, shared items, participants, and invitations;
- pending invitation acceptance and rejection.

All activity, calendar, import/export, and notification links that open a conversation route to `/work-hub/chat?channel=<id>`. Old `/work-hub/channels?channel=<id>` deep links remain compatible by forwarding the channel selection to the chat page instead of losing context.

## New Chat Interaction

The New Chat area has two separate selectors:

- **Select Group**
- **Select Person**

The selectors are mutually exclusive. Selecting a group clears the person selection; selecting a person clears the group selection. Selection only prepares the target. It never creates, opens, or sends anything automatically.

The action label depends on the selected target:

- group selected: **Start Chat**;
- person selected: **Send Invite**;
- no selection: disabled action.

### Starting a group chat

Clicking Start Chat snapshots the group’s current members into a conversation and opens it. The operation is idempotent: if a group conversation already exists, it reopens that conversation instead of creating a duplicate.

After creation, the conversation participant list is independent from the group. Later group membership changes do not silently add or remove chat participants. Additional participants enter only through an explicit invitation from the chat.

The backend may implement this with a dedicated group-chat command while retaining the existing channel tables. The stable context key is based on the owning organization and group identifier, and creation is transactionally locked so concurrent clicks cannot create duplicates.

### Starting a person chat

Clicking Send Invite uses the existing one-to-one chat command and idempotency behavior. Existing accepted conversations reopen rather than duplicate. Same-organization contacts retain the current immediate-contact behavior; cross-organization contacts receive a pending invitation and cannot read the conversation until they accept.

The UI reports the actual result: either the conversation opened or an invitation was sent.

## Relationship-Scoped Person Directory

The person selector is not a global VNDRLY directory.

Eligible people are limited to:

1. active members of the user’s current organization;
2. active members of organizations connected through an **approved** partner/vendor relationship;
3. existing shared-chat peers already authorized by the current collaboration rules.

For a vendor, approved partner relationships expose eligible people in those partner organizations. For a partner, approved vendor relationships expose eligible people in those vendor organizations. Unapproved, pending, auto-unapproved, revoked, unrelated, suspended, or inactive accounts are excluded.

Search may match display name or email server-side, but results return only:

- user identifier;
- display name;
- organization name;
- organization type;
- role label;
- whether the person is in the same organization.

Email addresses are not returned or displayed. A result is rendered as, for example, **Jane Smith · Flywheel · Gate Admin**.

The server revalidates relationship eligibility when Send Invite is clicked. A stale search result cannot bypass a revoked relationship.

## Invitations and Participant Management

- Cross-organization invitations always require acceptance.
- Only a conversation owner or an actor with existing channel-management authority can invite another person.
- The invite-person picker inside an existing chat uses the same relationship-scoped directory.
- Existing members and pending invitees are excluded from the picker.
- Declined or revoked invitations do not grant any read access.
- A removed participant loses access through the existing membership checks; audit history remains intact.

## Component Structure

The current combined `CollaborationWorkspace` is decomposed into focused components:

- `GroupsWorkspace`: group list and group management only;
- `CompanyChatWorkspace`: conversation list, new-chat target selection, and selected conversation;
- shared conversation primitives for list, message workspace, participant management, and mutation/error handling;
- shared person-search picker consuming the relationship-scoped people endpoint.

This avoids both fragile conditional hiding and duplicated chat logic. The route switch in Work Hub renders the focused component directly.

## API Changes

### `GET /work-hub/people`

Extend the endpoint to return relationship-scoped directory results and organization/role labels. Preserve the search length limit and result cap. Never return email.

### `POST /work-hub/chats/groups`

Accept a group identifier and operation identifier. Validate that the actor can read the group and that the group has at least one current member. Transactionally create or return the canonical group conversation, snapshot current members, and return the conversation.

### Existing invitation endpoints

Reuse the existing one-to-one and channel invitation flows, but centralize relationship eligibility so search and mutation authorization use the same rule. Cross-organization acceptance remains mandatory.

No database reset, destructive migration, or history rewrite is required. The existing channel, channel-member, collaboration-channel, invitation, crew, and crew-member records remain the source of truth.

## Error Handling

- No target selected: action disabled.
- Group archived, deleted, inaccessible, or empty before Start Chat: show a concise inline error and do not create a conversation.
- Relationship changed before Send Invite: return a privacy-safe unavailable result and refresh the directory.
- Existing conversation: reopen it.
- Pending duplicate invitation: show that the invitation is already pending.
- Last group owner removal: preserve the server rejection and explain that another owner must be assigned first.
- Network or server failure: keep the selection so the user can retry safely with the same idempotent operation.

## Compatibility and Scope

- Existing conversations and messages remain accessible.
- Existing bookmarked conversation links are forwarded to Company Chat.
- Backend crew/channel names remain internal implementation details.
- This design changes web and API behavior. It does not require a destructive database migration.
- Mobile and TestFlight presentation changes are outside this implementation unless separately requested; the server permission and invitation rules remain reusable by mobile clients.

## Verification

### Web contracts

- navigation labels are Groups and `{Company Name} Chat`;
- Groups is one full-width management surface with no chat controls;
- Company Chat owns conversation search and content;
- group and person selectors are distinct and mutually exclusive;
- selecting alone causes no mutation;
- action label changes correctly;
- group Start Chat opens or reopens the canonical conversation;
- person Send Invite preserves same-org and cross-org behavior;
- deep links open Company Chat;
- all new controls use the shared branded input, select, button, and modal standards.

### API contracts

- directory includes same-org and approved related-org users;
- directory excludes unrelated and non-approved relationships;
- directory never returns email;
- mutation authorization rechecks the relationship;
- cross-org invite requires acceptance;
- group-chat creation snapshots membership and is idempotent under retries/concurrency;
- later group changes do not alter the conversation participant list;
- existing access-control and tenant-isolation suites remain green.

### Release gates

- focused web and API tests;
- web type check;
- API type check;
- full web suite;
- full API suite against the isolated test database;
- production web build;
- API build;
- no unrelated mobile, database, or generated-artifact changes.
