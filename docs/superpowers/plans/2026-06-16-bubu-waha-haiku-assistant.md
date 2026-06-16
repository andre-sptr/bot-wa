# Bubu WAHA Haiku Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Bubu on `claude-haiku-4-5-20251001` while making Bubu act like a practical WhatsApp assistant that understands DM/group context, resolves people/groups from WAHA data, sends explicit outbound chats, mentions people, and uses literal `@semua` for tag-all.

**Architecture:** Add a small WAHA identity layer that normalizes message/chat/contact IDs before existing webhook logic uses them. Build a persisted chat/contact directory from WAHA `/chats`, `/lids`, `/groups/{groupId}/participants/v2`, and `/api/contacts`, then route explicit outbound commands through a deterministic action executor instead of relying only on Haiku to emit raw `<dm>` tags. Reduce the static Bubu prompt so Haiku spends more attention on the user message and compact runtime context.

**Tech Stack:** Node.js CommonJS, Express, WAHA WEBJS API, Anthropic SDK, Node built-in test runner, existing JSON file storage.

---

## Spec

### Context

Bubu currently runs as a WhatsApp bot over WAHA and uses `claude-haiku-4-5-20251001`. The current first-chat behavior is often generic because the Haiku call receives a long persona, random mood instructions, and mandatory `<reasoning>/<response>` formatting before the actual user message. The user wants to keep Haiku for cost, but make Bubu feel like a real WhatsApp assistant with DM, group send, mention, tag-all, and silent context awareness.

### Verified Current State

Verification date: 2026-06-16.

| Area | Evidence | Current Behavior | Gap |
|------|----------|------------------|-----|
| Model | `server.js:91`, `server.js:210`, `.env` observed `ANTHROPIC_MODEL=claude-haiku-4-5-20251001` | Haiku is already configured | Keep model, optimize prompt and routing |
| Persona | `modules/bubuPersona.js:2`, `modules/bubuPersona.js:93` | Persona is about 5.7k chars and requires reasoning tags for every reply | Too much instruction load for first chat |
| Mood | `modules/aiAdvanced.js:239`, `modules/reasoningEngine.js:138` | Random/time mood is injected into every AI call | User approved removing mood burden |
| Runtime context | `modules/contextPack.js:92` | Context is rendered as long prose with JIDs, chat ids, roster instructions | Needs compact structured context |
| WAHA chat parser | `modules/messageTriggers.js:141`, `modules/messageTriggers.js:156` | Parser chooses chat from `payload.chatId`, `from`, `to`, `_data.id.remote`, etc. | Outgoing DM can be misread as bot LID instead of target LID |
| Bot message tracking | `modules/messageTriggers.js:111` | `_serialized` parts are used to learn bot identifiers | Self-DM ids ending `_out` can add `out` and `out@c.us` as bot identifiers |
| Send WA | `server.js:267` | `sendWA(text, chatId, mentions)` calls `POST /api/sendText` | Needs request target recorded for outgoing DM aliasing |
| Roster | `modules/groupRoster.js:81`, `modules/groupRoster.js:20` | Fetches participants and enriches names via contacts endpoint | Should be part of reusable directory |
| LID resolver | `modules/lidResolver.js:3` | Resolves `@lid` to `@c.us` through `/api/{session}/lids/{lid}` | Should feed directory aliases |
| DM safety | `modules/dmSafety.js:21` | Allows DMs only to known sender/current roster targets | User now allows direct sends to known WAHA chats and groups |
| Mentions | `modules/mentionHelper.js:67`, `modules/mentionHelper.js:125` | `@all` and `@semua` expand to all mentionable phone JIDs | User wants literal `@semua`, not expanded mentions |

### Grounded WAHA Data

Read-only and approved send tests on 2026-06-16 established:

| Endpoint | Observed Shape | Implementation Meaning |
|----------|----------------|------------------------|
| `GET /api/sessions/BotWA` | `{ name, status: "WORKING", me: { id, pushName }, engine: { engine: "WEBJS", state: "CONNECTED" } }` | Session health can be checked without sending messages |
| `GET /api/BotWA/chats?limit=50` | Array of chats. Group ids are `@g.us`; DMs are mostly `@lid`; groups include `groupMetadata.participants` | Build chat directory from this, not only `GROUP_ID` |
| `GET /api/BotWA/groups/{groupId}/participants/v2` | Array of `{ id, pn, role }`, where `id` and `pn` are string `@c.us` in the tested group | Use as group member source for DM and name resolution |
| `GET /api/contacts?session=BotWA&contactId={id}` | `{ id, number, name, pushname, shortName, isUser, isGroup }` | Enrich participants and DM contacts by display name |
| `GET /api/BotWA/lids/{lid}` | `{ lid, pn }` | Store alias from modern `@lid` DM ids to canonical `@c.us` |
| `POST /api/sendText` | Request `{ session, chatId, text, mentions? }`; response includes message object | Outbound actions can target any known `chatId` |

Approved send tests:

1. DM to `6282387025429@c.us` returned response `remote/to` as an `@lid` target. The same message appeared in `/chats` under that `@lid`.
2. Group send to `.env` `GROUP_ID` returned response `remote` as `@g.us` and `participant` as bot LID.
3. Self-DM returned `_serialized` ending `_out`; current bot identifier parser must not treat `_out` as a contact.

### Product Decisions

1. Bubu must always refer to itself as `Bubu`, never `aku`, `gue`, `saya`, or `I`.
2. Bubu may send outbound DM/group messages only when the user explicitly asks, including natural phrases such as `DM Andre`, `chat Andre`, `kirim pesan ke Andre`, `bilangin Andre`, and `kirim ke grup X`.
3. Outbound send can happen immediately without confirmation.
4. After sending, Bubu must confirm in the origin chat.
5. Tag-all uses literal `@semua` text, not expanded per-member mentions.
6. Bubu should know context internally but not announce DM/group/chat name/JID unless asked.

### Proposed Change

Add deterministic WhatsApp capability around Haiku:

1. `wahaIdentity`: parse WAHA chat/message/contact objects into a normalized internal shape.
2. `chatDirectory`: persist known chats, contacts, group aliases, LID-to-phone aliases, and display names.
3. `wahaClient`: wrap read-only WAHA calls needed by the directory and route all WAHA HTTP through one client.
4. `outboundActions`: parse explicit outbound requests from Bubu/Haiku output and execute sends to resolved contacts/groups.
5. Prompt simplification: shrink Bubu persona, remove mood injection from normal calls, stop requiring `<reasoning>` for fast path.
6. Mention correction: keep named mentions through WAHA mentions array, but send literal `@semua` for tag-all.

### Data Contracts

#### Normalized Chat

```js
{
  id: "232701932138501@lid",
  canonicalId: "6282387025429@c.us",
  type: "dm",
  name: "+62 823-8702-5429",
  aliases: ["232701932138501@lid", "6282387025429@c.us", "6282387025429"],
  source: "chats",
  updatedAt: "2026-06-16T11:23:22.107Z"
}
```

#### Normalized Group

```js
{
  id: "120363424766297041@g.us",
  type: "group",
  name: "Today",
  aliases: ["today", "120363424766297041@g.us"],
  participantCount: 5,
  source: "chats",
  updatedAt: "2026-06-16T11:23:22.107Z"
}
```

#### Normalized Message

```js
{
  id: "true_120363424766297041@g.us_3EB02C8F249243772F62BF_138384550936741@lid",
  messageId: "3EB02C8F249243772F62BF",
  chatId: "120363424766297041@g.us",
  chatType: "group",
  senderJid: "138384550936741@lid",
  canonicalSenderJid: "6285111604384@c.us",
  fromMe: true,
  body: "text",
  type: "chat",
  timestamp: 1781609002,
  mentionedIds: [],
  quoted: null
}
```

#### Outbound Action

```js
{
  type: "send_dm",
  targetText: "Andre",
  targetChatId: "6282387025429@c.us",
  message: "isi pesan",
  originChatId: "120363424766297041@g.us",
  confirmation: "Bubu udah chat Andre."
}
```

### Acceptance Criteria

1. `npm test` passes.
2. `rememberBotMessage()` never adds `out`, `out@c.us`, or malformed `_serialized` suffixes to `botIdentifiers`.
3. Outgoing DM payloads from WAHA are parsed with target chat as `payload.to` or `id.remote`, not bot `payload.from`.
4. `@lid` DM chat ids from `/chats` resolve to canonical `@c.us` when `/lids/{lid}` returns `pn`.
5. Directory can resolve a contact by exact phone, `@c.us`, `@lid`, `name`, `pushname`, and `shortName`.
6. Directory can resolve a group by exact `@g.us` and case-insensitive group name from `/chats`.
7. `chat Andre bilang test` sends exactly one WAHA message to Andre's resolved chat id and one confirmation to the origin chat.
8. `kirim ke grup Today bilang test` sends exactly one WAHA message to the resolved group id and one confirmation to the origin chat.
9. Named mentions still include WAHA `mentions` array for resolved people.
10. Tag-all text `@semua` is sent literally and does not expand into a member list or mentions array.
11. First-chat simple prompts such as `halo bubu` and `bubu siapa?` do not require `<reasoning>` output and return a short natural Bubu response.
12. Bubu never exposes JIDs, chat ids, group names, or `[privat]` memory unless the user directly asks.

### Testing Plan

| Layer | What | Count |
|-------|------|-------|
| Unit | `wahaIdentity` parsing for DM, group, outgoing, `_out`, quoted, mentions | +10 |
| Unit | `chatDirectory` alias storage and resolution | +8 |
| Unit | `outboundActions` parsing and execution with mocked `sendWA` | +8 |
| Unit | Prompt/persona budget and no required reasoning tags | +4 |
| Integration | `webhookProcessor` explicit outbound DM/group and confirmation | +4 |
| Integration | Mention/tag-all behavior | +3 |
| Live manual | WAHA send to approved DM and group after implementation | +2 |

### Rollback Plan

1. Revert the PR to restore current webhook/prompt behavior.
2. If only outbound actions fail, set `BUBU_OUTBOUND_ACTIONS=false` and leave chat response behavior intact.
3. If prompt quality regresses, set `BUBU_LEGACY_PERSONA=true` to use the old persona while keeping parser/directory fixes.
4. Directory files are additive JSON under `data/`; deleting `data/chat_directory.json` forces rebuild from WAHA.

### Out of Scope

- Sending media, stickers, voice notes, documents, or images.
- Admin-only group operations.
- Persistent autonomous proactive outbound messages.
- Full CRM/contact import outside WAHA-observed chats and groups.
- Changing away from Haiku.

## File Structure

| File | Responsibility |
|------|----------------|
| `modules/wahaIdentity.js` | Normalize WAHA ids, chats, messages, contacts, and serialized message ids |
| `modules/chatDirectory.js` | Persist and resolve known contacts/groups/aliases |
| `modules/wahaClient.js` | Central WAHA GET/POST wrapper for sessions, chats, lids, participants, contacts, sendText |
| `modules/outboundActions.js` | Parse and execute explicit outbound send instructions |
| `modules/bubuPersona.js` | Smaller identity-only Bubu persona |
| `modules/reasoningEngine.js` | Fast Haiku path without mandatory `<reasoning>` output |
| `modules/contextPack.js` | Compact runtime context renderer |
| `modules/messageTriggers.js` | Use identity helpers and fix outgoing/self-DM parsing |
| `modules/mentionHelper.js` | Keep named mentions, make tag-all literal `@semua` |
| `modules/webhookProcessor.js` | Wire directory/action executor into incoming handling |
| `server.js` | Instantiate WAHA client/directory/action executor |
| `test/wahaIdentity.test.js` | New identity parser tests |
| `test/chatDirectory.test.js` | New directory resolver tests |
| `test/outboundActions.test.js` | New outbound parser/executor tests |
| `test/bubuPersona.test.js` | Update expected prompt behavior |
| `test/reasoningEngine.test.js` | Update fast/deep routing expectations |
| `test/mentionHelper.test.js` | Update literal tag-all expectations |
| `test/webhookProcessor.test.js` | Add outbound integration tests |

## Tasks

### Task 1: Add WAHA Identity Parser

**Files:**
- Create: `modules/wahaIdentity.js`
- Create: `test/wahaIdentity.test.js`
- Modify: `modules/messageTriggers.js`
- Modify: `test/messageTriggers.test.js`

- [ ] **Step 1: Write failing tests for normalized IDs and `_out` serialized messages**

Add `test/wahaIdentity.test.js` with tests covering these concrete cases:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  asSerializedId,
  normalizeContactId,
  parseSerializedMessageId,
  normalizeWahaMessage,
} = require('../modules/wahaIdentity');

test('asSerializedId extracts _serialized from WAHA id object', () => {
  assert.equal(asSerializedId({ _serialized: '232701932138501@lid' }), '232701932138501@lid');
});

test('normalizeContactId converts s.whatsapp.net to c.us', () => {
  assert.equal(normalizeContactId('6282387025429@s.whatsapp.net'), '6282387025429@c.us');
});

test('parseSerializedMessageId ignores self-DM _out suffix as participant', () => {
  const parsed = parseSerializedMessageId('true_138384550936741@lid_3EB01D7751A9FAB0FAB886_out');
  assert.equal(parsed.fromMe, true);
  assert.equal(parsed.remote, '138384550936741@lid');
  assert.equal(parsed.messageId, '3EB01D7751A9FAB0FAB886');
  assert.equal(parsed.participant, '');
});

test('parseSerializedMessageId keeps group participant lid', () => {
  const parsed = parseSerializedMessageId('true_120363424766297041@g.us_3EB02C8F249243772F62BF_138384550936741@lid');
  assert.equal(parsed.remote, '120363424766297041@g.us');
  assert.equal(parsed.participant, '138384550936741@lid');
});

test('normalizeWahaMessage uses outgoing DM target from to field', () => {
  const msg = normalizeWahaMessage({
    fromMe: true,
    id: {
      fromMe: true,
      remote: '232701932138501@lid',
      id: '3EB044DD918C5533BB16F4',
      _serialized: 'true_232701932138501@lid_3EB044DD918C5533BB16F4',
    },
    from: '138384550936741@lid',
    to: '232701932138501@lid',
    body: 'Bubu test',
    type: 'chat',
  });
  assert.equal(msg.chatId, '232701932138501@lid');
  assert.equal(msg.senderJid, '138384550936741@lid');
  assert.equal(msg.fromMe, true);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run:

```bash
node --test test/wahaIdentity.test.js
```

Expected: FAIL with `Cannot find module '../modules/wahaIdentity'`.

- [ ] **Step 3: Implement `modules/wahaIdentity.js`**

Create:

```js
const asSerializedId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return asSerializedId(value._serialized || value.serialized || value.id || value.ID || '');
  return '';
};

const normalizeIdText = (value) => asSerializedId(value).trim().toLowerCase();

const normalizeContactId = (value) => {
  const id = normalizeIdText(value).replace(/^@/, '');
  if (!id) return '';
  if (id.endsWith('@s.whatsapp.net')) return `${id.slice(0, -'@s.whatsapp.net'.length)}@c.us`;
  return id;
};

const parseSerializedMessageId = (value) => {
  const raw = normalizeIdText(value);
  const parts = raw.split('_');
  if (parts.length < 3) return { raw, fromMe: null, remote: '', messageId: raw, participant: '' };

  const suffix = parts.slice(3).join('_');
  const participant = suffix && suffix !== 'out' && suffix.includes('@') ? suffix : '';

  return {
    raw,
    fromMe: parts[0] === 'true' ? true : parts[0] === 'false' ? false : null,
    remote: normalizeContactId(parts[1]),
    messageId: parts[2] || '',
    participant: normalizeContactId(participant),
  };
};

const first = (...values) => values.map(asSerializedId).find(Boolean) || '';

const normalizeWahaMessage = (payload = {}) => {
  const data = payload._data || {};
  const idObj = payload.id || data.id || {};
  const parsedId = parseSerializedMessageId(first(idObj._serialized, idObj, data.id));
  const fromMe = payload.fromMe === true || idObj.fromMe === true || data.fromMe === true || data.id?.fromMe === true;
  const from = normalizeContactId(first(payload.from, data.from));
  const to = normalizeContactId(first(payload.to, data.to));
  const remote = normalizeContactId(first(payload.chatId, idObj.remote, data.id?.remote, data.key?.remoteJid, data.Info?.Chat, parsedId.remote));
  const isGroup = remote.endsWith('@g.us') || to.endsWith('@g.us') || from.endsWith('@g.us');
  const chatId = isGroup ? (remote.endsWith('@g.us') ? remote : first(from, to)) : (fromMe ? first(to, remote, from) : first(remote, from, to));
  const participant = normalizeContactId(first(payload.participant, payload.author, data.author, idObj.participant, data.id?.participant, data.Info?.Sender, parsedId.participant));
  const senderJid = fromMe ? from : (isGroup ? participant || from : from || chatId);

  return {
    id: first(idObj._serialized, idObj, data.id),
    messageId: parsedId.messageId || first(idObj.id, data.id?.id),
    chatId,
    chatType: chatId.endsWith('@g.us') ? 'group' : 'dm',
    senderJid,
    fromMe,
    body: String(payload.body || data.body || data.caption || payload.caption || ''),
    type: String(payload.type || data.type || ''),
    timestamp: payload.timestamp || data.t || null,
    participant,
    mentionedIds: payload.mentionedIds || data.mentionedJidList || [],
    raw: payload,
  };
};

module.exports = {
  asSerializedId,
  normalizeIdText,
  normalizeContactId,
  parseSerializedMessageId,
  normalizeWahaMessage,
};
```

- [ ] **Step 4: Update `messageTriggers.js` to reuse identity helpers**

Replace local normalization helpers with imports from `wahaIdentity`, and update `rememberBotMessage` so it calls `parseSerializedMessageId` and only adds `participant` when it is a contact id. Do not add `out`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/wahaIdentity.test.js test/messageTriggers.test.js
```

Expected: PASS.

### Task 2: Add WAHA Client Wrapper

**Files:**
- Create: `modules/wahaClient.js`
- Create: `test/wahaClient.test.js`
- Modify: `server.js:120-131`

- [ ] **Step 1: Write failing tests for endpoint paths**

Create `test/wahaClient.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWahaClient } = require('../modules/wahaClient');

test('createWahaClient builds session scoped endpoints', async () => {
  const calls = [];
  const client = createWahaClient({
    wahaUrl: 'https://waha.example',
    session: 'BotWA',
    apiKey: 'key',
    httpGet: async (url, opts) => {
      calls.push({ url, opts });
      return { data: [] };
    },
    httpPost: async () => ({ data: {} }),
  });

  await client.chats({ limit: 20 });
  await client.participants('120@g.us');
  await client.contact('628@c.us');
  await client.resolveLid('123@lid');

  assert.match(calls[0].url, /\/api\/BotWA\/chats/);
  assert.match(calls[1].url, /\/api\/BotWA\/groups\/120%40g\.us\/participants\/v2/);
  assert.match(calls[2].url, /\/api\/contacts\?session=BotWA&contactId=628%40c\.us/);
  assert.match(calls[3].url, /\/api\/BotWA\/lids\/123%40lid/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test test/wahaClient.test.js
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement `modules/wahaClient.js`**

Create a factory exposing `sessions`, `sessionStatus`, `chats`, `participants`, `contact`, `resolveLid`, and `sendText`. Use injected `httpGet`/`httpPost` so tests do not need network.

- [ ] **Step 4: Wire `server.js` to instantiate `wahaClient`**

Keep existing `createGroupRosterClient` and `createLidResolver` alive until later tasks. Add the new client without removing old code yet to reduce risk.

- [ ] **Step 5: Run focused tests**

Run:

```bash
node --test test/wahaClient.test.js test/serverImports.test.js
```

Expected: PASS.

### Task 3: Add Chat Directory and Alias Resolution

**Files:**
- Create: `modules/chatDirectory.js`
- Create: `test/chatDirectory.test.js`
- Modify: `modules/webhookProcessor.js`
- Modify: `server.js`

- [ ] **Step 1: Write failing resolver tests**

Create `test/chatDirectory.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createChatDirectory } = require('../modules/chatDirectory');

test('directory resolves DM by name, phone, c.us, and lid alias', () => {
  const dir = createChatDirectory({ storageKey: 'test_chat_directory_unit' });
  dir.clear();
  dir.upsertContact({
    id: '232701932138501@lid',
    canonicalId: '6282387025429@c.us',
    name: 'Andre',
    pushname: 'Andre Saputra',
    shortName: 'Andre',
  });

  assert.equal(dir.resolveChat('Andre').id, '6282387025429@c.us');
  assert.equal(dir.resolveChat('6282387025429').id, '6282387025429@c.us');
  assert.equal(dir.resolveChat('232701932138501@lid').id, '6282387025429@c.us');
});

test('directory resolves group by name and g.us id', () => {
  const dir = createChatDirectory({ storageKey: 'test_chat_directory_group' });
  dir.clear();
  dir.upsertGroup({ id: '120363424766297041@g.us', name: 'Today', participantCount: 5 });

  assert.equal(dir.resolveChat('today').id, '120363424766297041@g.us');
  assert.equal(dir.resolveChat('120363424766297041@g.us').type, 'group');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test test/chatDirectory.test.js
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement `chatDirectory`**

Use `modules/storage.js`. Store:

```js
{
  contacts: {},
  groups: {},
  aliases: {}
}
```

Expose `upsertContact`, `upsertGroup`, `resolveChat`, `knownDmTargets`, `clear`, and `snapshot`. Alias keys must be lowercase and trimmed.

- [ ] **Step 4: Feed directory from incoming chats**

In `webhookProcessor`, after normalized identity is available, upsert current DM/group. In `server.js`, add a startup best-effort refresh from `/chats?limit=50` once `wahaClient` exists.

- [ ] **Step 5: Run tests**

Run:

```bash
node --test test/chatDirectory.test.js test/webhookProcessor.test.js
```

Expected: PASS.

### Task 4: Fix Literal `@semua` Tag-All Behavior

**Files:**
- Modify: `modules/mentionHelper.js:67-160`
- Modify: `test/mentionHelper.test.js:135-215`

- [ ] **Step 1: Update tests first**

Change tag-all tests to assert:

```js
test('extractMentionIntents treats @semua as literal tag-all command', () => {
  const intents = extractMentionIntents('Hey @semua cek ya', ROSTER);
  assert.deepEqual(intents, [{ matchedText: '@semua', participant: null, tagAll: true }]);
});

test('formatMentionedReply keeps @semua literal and does not build mentions array', () => {
  const result = formatMentionedReply('Hey @semua cek', [{ matchedText: '@semua', participant: null, tagAll: true }]);
  assert.equal(result.text, 'Hey @semua cek');
  assert.deepEqual(result.mentions, []);
});
```

- [ ] **Step 2: Run mention tests to verify failure**

Run:

```bash
node --test test/mentionHelper.test.js
```

Expected: FAIL because old code expands tag-all.

- [ ] **Step 3: Implement literal tag-all**

In `extractMentionIntents`, return a single tagAll intent for `@semua`, `@all`, or `@everyone` without adding participants. In `formatMentionedReply`, leave tagAll text unchanged and do not push mentions.

- [ ] **Step 4: Run mention tests**

Run:

```bash
node --test test/mentionHelper.test.js
```

Expected: PASS.

### Task 5: Add Outbound Action Parser and Executor

**Files:**
- Create: `modules/outboundActions.js`
- Create: `test/outboundActions.test.js`
- Modify: `modules/webhookProcessor.js`
- Modify: `modules/reasoning.js`

- [ ] **Step 1: Write parser and executor tests**

Create `test/outboundActions.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseOutboundRequests,
  executeOutboundRequests,
} = require('../modules/outboundActions');

test('parseOutboundRequests detects chat natural language intent', () => {
  const actions = parseOutboundRequests('chat Andre bilang meeting jam 3');
  assert.deepEqual(actions, [{ type: 'send_dm', targetText: 'Andre', message: 'meeting jam 3' }]);
});

test('parseOutboundRequests detects group send intent', () => {
  const actions = parseOutboundRequests('kirim ke grup Today bilang deploy aman');
  assert.deepEqual(actions, [{ type: 'send_group', targetText: 'Today', message: 'deploy aman' }]);
});

test('executeOutboundRequests sends resolved target and origin confirmation', async () => {
  const sent = [];
  const directory = {
    resolveChat: (target) => target === 'Andre'
      ? { id: '6282387025429@c.us', type: 'dm', name: 'Andre' }
      : null,
  };
  const result = await executeOutboundRequests({
    actions: [{ type: 'send_dm', targetText: 'Andre', message: 'ping' }],
    directory,
    sendWA: async (text, chatId) => {
      sent.push({ text, chatId });
      return { ok: true };
    },
    originChatId: '120@g.us',
  });

  assert.equal(result.sent.length, 1);
  assert.deepEqual(sent, [
    { text: 'ping', chatId: '6282387025429@c.us' },
    { text: 'Bubu udah chat Andre.', chatId: '120@g.us' },
  ]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test test/outboundActions.test.js
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement `modules/outboundActions.js`**

Support these patterns:

```txt
dm <target> bilang <message>
chat <target> bilang <message>
kirim pesan ke <target> bilang <message>
bilangin <target> <message>
kirim ke grup <target> bilang <message>
chat grup <target> bilang <message>
```

Return no actions unless the message clearly contains an outbound verb and message body.

- [ ] **Step 4: Wire executor into `webhookProcessor`**

Before AI response for natural language, run deterministic parser on `msgBody`. If it returns actions, execute them, record debug stages, and skip the AI reply. This avoids asking Haiku to decide whether to send real messages.

- [ ] **Step 5: Keep legacy `<dm>` path temporarily**

Do not remove `extractDMs` yet. Keep it as fallback for AI-emitted DM tags, but change allowed targets to use directory known contacts/groups.

- [ ] **Step 6: Run focused tests**

Run:

```bash
node --test test/outboundActions.test.js test/webhookProcessor.test.js test/dmSafetyProcessor.test.js
```

Expected: PASS.

### Task 6: Simplify Bubu Persona and Haiku Fast Path

**Files:**
- Modify: `modules/bubuPersona.js`
- Modify: `modules/reasoningEngine.js`
- Modify: `modules/aiAdvanced.js`
- Modify: `modules/contextPack.js`
- Modify: `test/bubuPersona.test.js`
- Modify: `test/reasoningEngine.test.js`
- Modify: `test/moodContext.test.js`
- Modify: `test/livePolicy.js`
- Modify: `test/liveReasoning.js`
- Modify: `test/evalQuality.js`

- [ ] **Step 1: Update persona tests**

Change tests so they assert:

```js
assert.match(p, /Kamu adalah Bubu/);
assert.match(p, /dibuat oleh Andre Saputra/);
assert.match(p, /Bubu selalu menyebut diri Bubu/);
assert.doesNotMatch(p, /<reasoning>/);
assert.doesNotMatch(p, /MOOD|mood/i);
assert.ok(p.length < 1200);
```

- [ ] **Step 2: Run persona tests to verify failure**

Run:

```bash
node --test test/bubuPersona.test.js
```

Expected: FAIL because current persona is long and contains `<reasoning>`/mood.

- [ ] **Step 3: Replace persona with compact identity**

Use this system text in `buildBubuPersona`:

```js
return `Kamu adalah Bubu, asisten WhatsApp buatan Andre Saputra.
Bubu selalu menyebut diri "Bubu", bukan aku/gue/saya/I.
Bubu ngobrol singkat, natural, dan nyambung seperti orang di WhatsApp.
Bubu tahu konteks chat, pengirim, DM/grup, dan target pesan dari sistem, tapi jangan menyebut konteks itu kecuali ditanya.
Bubu jujur kalau tidak tahu dan tidak mengarang.
Default balasan 1-3 kalimat. Untuk tugas teknis, boleh ringkas dengan poin.
Kalau diminta mengirim chat ke orang/grup, ikuti instruksi sistem action. Setelah terkirim, konfirmasi singkat di chat asal.
Kalau diminta tag semua, gunakan literal @semua.`;
```

Keep `botPhone` only if needed as hidden context, not identity prose.

- [ ] **Step 4: Remove mood injection from normal path**

In `reasoningEngine.js`, remove `getCurrentMoodContext()` from `dynamicSystemText` for normal calls. If proactive mode still needs stricter behavior, add a short mode block from `contextPack`, not random mood.

- [ ] **Step 5: Stop requiring `<reasoning>` in fast path**

Update `executeFastReasoning` so it accepts plain text. Keep `parseBubuReply` compatibility but do not instruct the model to output tags. For deep path, keep internal two-pass planning but only return final user-facing text.

- [ ] **Step 6: Compact context renderer**

Change `renderContextPackForPrompt` to a short structured block:

```txt
Runtime context, do not announce:
chat.type=group
chat.name=Today
sender.name=Andre
sender.id=6282387025429@c.us
message.replyTo=...
privacy=private memories stay private
capabilities=send_dm, send_group, mention_user, tag_all_literal
```

- [ ] **Step 7: Run prompt tests**

Run:

```bash
node --test test/bubuPersona.test.js test/contextPack.test.js test/reasoningEngine.test.js
```

Expected: PASS after updating expectations.

### Task 7: Wire Directory Into DM Safety and Legacy AI DM Tags

**Files:**
- Modify: `modules/dmSafety.js`
- Modify: `modules/webhookProcessor.js`
- Modify: `test/dmSafety.test.js`
- Modify: `test/dmSafetyProcessor.test.js`

- [ ] **Step 1: Update DM safety tests**

Add a test where `knownTargets` includes directory contacts beyond current sender/roster.

```js
test('splitAllowedDMs allows directory known target', () => {
  const knownTargets = new Set(['6282387025429@c.us']);
  const { allowed, blocked } = splitAllowedDMs([
    { target: '6282387025429@c.us', message: 'ping' },
    { target: '6280000000000@c.us', message: 'no' },
  ], knownTargets);
  assert.equal(allowed.length, 1);
  assert.equal(blocked.length, 1);
});
```

- [ ] **Step 2: Run DM safety tests to verify current behavior**

Run:

```bash
node --test test/dmSafety.test.js test/dmSafetyProcessor.test.js
```

Expected: existing tests pass; new directory-specific wiring fails until processor includes directory targets.

- [ ] **Step 3: Add directory known targets to processor**

When extracting `<dm>` tags from AI output, merge:

```js
collectKnownDmTargets({ chatId, senderJid, canonicalSenderJid, roster })
directory.knownDmTargets()
```

- [ ] **Step 4: Run tests**

Run:

```bash
node --test test/dmSafety.test.js test/dmSafetyProcessor.test.js test/webhookProcessor.test.js
```

Expected: PASS.

### Task 8: Add Live Grounding Fixtures for Future Regression

**Files:**
- Create: `test/fixtures/waha-send-dm.json`
- Create: `test/fixtures/waha-send-group.json`
- Create: `test/fixtures/waha-chats-summary.json`
- Modify: `test/wahaIdentity.test.js`

- [ ] **Step 1: Add sanitized fixtures**

Create fixtures using the observed shapes, with fake ids but same suffixes:

```json
{
  "id": {
    "fromMe": true,
    "remote": "232701932138501@lid",
    "id": "3EB044DD918C5533BB16F4",
    "_serialized": "true_232701932138501@lid_3EB044DD918C5533BB16F4"
  },
  "body": "Bubu test WAHA DM ke Andre - ignore",
  "from": "138384550936741@lid",
  "to": "232701932138501@lid",
  "fromMe": true,
  "type": "chat"
}
```

- [ ] **Step 2: Update identity tests to load fixtures**

Use `require('./fixtures/waha-send-dm.json')` and assert normalized values.

- [ ] **Step 3: Run identity tests**

Run:

```bash
node --test test/wahaIdentity.test.js
```

Expected: PASS.

### Task 9: Full Verification

**Files:**
- No code changes.

- [ ] **Step 1: Run full unit suite**

Run:

```bash
npm test
```

Expected: all `node --test test/*.test.js` tests pass.

- [ ] **Step 2: Run policy and quality eval if Anthropic credentials are active**

Run:

```bash
npm run test:policy
npm run eval:quality
```

Expected: pass or skip only on documented auth/model unavailability.

- [ ] **Step 3: Manual WAHA smoke test**

With user approval, send:

```txt
chat Andre bilang ini test Bubu, ignore ya
kirim ke grup Today bilang ini test Bubu, ignore ya
tag semua di grup: @semua ini test ignore
```

Expected:

1. DM target receives the message.
2. Origin chat receives confirmation.
3. Group target receives the message.
4. Literal `@semua` appears as text and WAHA `mentions` array is empty.

## Self-Review

Spec coverage:

- Haiku optimization: Task 6.
- WAHA JSON grounding and parser: Tasks 1, 2, 8.
- DM/group outbound: Tasks 3, 5, 7.
- Mention and literal tag-all: Task 4.
- Live bug fixes for `_out` and outgoing DM chat id: Task 1.
- Tests and verification: Tasks 1-9.

Placeholder scan:

- No `TBD`, `TODO`, or "implement later" placeholders.
- Each task includes exact files and test commands.

Type consistency:

- `chatId`, `canonicalId`, `senderJid`, `targetText`, `targetChatId`, and `message` names are consistent across spec and tasks.
