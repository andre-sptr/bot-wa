# Bubu Awareness Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inject dynamic per-message awareness so Bubu knows whether a reply is happening in DM or a group, who sent it, and the chat identity, while preserving the anti-recite behavior from Phase 2.

**Architecture:** Keep static identity in `modules/bubuPersona.js`; add a small dynamic context builder in `modules/aiAdvanced.js` so runtime context remains outside the cached static system block. `server.js` should derive chat metadata from WAHA payload once, pass it through `handleNaturalLanguage`, and keep `makeAskAI` responsible only for final Anthropic call assembly.

**Tech Stack:** Node.js CommonJS, `node:test`, WAHA webhook payload helpers, Anthropic Messages API system blocks.

---

### Task 1: Dynamic Awareness Prompt Builder

**Files:**
- Modify: `modules/aiAdvanced.js`
- Create: `test/awarenessContext.test.js`

- [x] **Step 1: Write the failing tests**

Add tests for a pure `buildDynamicAwarenessContext` function:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDynamicAwarenessContext } = require('../modules/aiAdvanced');

test('builds DM awareness as background context, not announcement copy', () => {
    const text = buildDynamicAwarenessContext({
        chatType: 'dm',
        senderName: 'Andre',
        senderJid: '628123@c.us',
        chatId: '628123@c.us',
    });

    assert.match(text, /chat pribadi \(DM\)/i);
    assert.match(text, /Pengirim: Andre/);
    assert.match(text, /LATAR BELAKANG/i);
    assert.match(text, /jangan.*umumin|jangan.*sebut/i);
});

test('builds group awareness with group name when available', () => {
    const text = buildDynamicAwarenessContext({
        chatType: 'group',
        chatName: 'Draft Awareness',
        senderName: 'Rina',
        senderJid: '123@lid',
        chatId: '120@g.us',
    });

    assert.match(text, /grup/i);
    assert.match(text, /Nama grup: Draft Awareness/);
    assert.match(text, /Pengirim: Rina/);
});

test('omits missing optional details without leaking undefined', () => {
    const text = buildDynamicAwarenessContext({ chatType: 'group' });

    assert.ok(text.length > 0);
    assert.doesNotMatch(text, /undefined|null/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/awarenessContext.test.js`

Expected: FAIL because `buildDynamicAwarenessContext` is not exported.

- [x] **Step 3: Implement minimal builder**

Add `buildDynamicAwarenessContext` to `modules/aiAdvanced.js` and export it. It returns a short Indonesian background block:

```js
const buildDynamicAwarenessContext = ({ chatType, chatName, senderName, senderJid, chatId } = {}) => {
    const lines = [
        'Konteks percakapan saat ini (LATAR BELAKANG, bukan buat diumumin):',
        '- Pakai ini untuk memahami situasi, tone, dan audiens.',
        '- Jangan sebut DM/grup/nama grup/JID kecuali user nanya langsung.',
    ];

    if (chatType === 'dm') lines.push('- Tipe chat: chat pribadi (DM).');
    else if (chatType === 'group') lines.push('- Tipe chat: grup.');
    if (chatName) lines.push(`- Nama grup: ${chatName}.`);
    if (senderName) lines.push(`- Pengirim: ${senderName}.`);
    if (senderJid) lines.push(`- ID pengirim: ${senderJid}.`);
    if (chatId) lines.push(`- ID chat: ${chatId}.`);
    return lines.join('\n');
};
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/awarenessContext.test.js`

Expected: PASS.

---

### Task 2: Wire Dynamic Context Through Natural Language Flow

**Files:**
- Modify: `server.js`
- Modify: `modules/aiAdvanced.js`
- Modify: `test/awarenessContext.test.js`

- [x] **Step 1: Write failing integration-style unit tests**

Add tests around `contextAwareResponse` by passing a fake `askAI` that captures its `systemPrompt`:

```js
test('contextAwareResponse includes dynamic chat awareness in system prompt', async () => {
    let capturedSystemPrompt = '';
    const askAI = async (systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return 'ok';
    };

    await contextAwareResponse('halo', askAI, {
        senderName: 'Andre',
        memoryContext: 'pernah bahas awareness',
        chatContext: {
            chatType: 'group',
            chatName: 'Draft Awareness',
            senderJid: '123@lid',
            chatId: '120@g.us',
        },
    });

    assert.match(capturedSystemPrompt, /Nama grup: Draft Awareness/);
    assert.match(capturedSystemPrompt, /Pengirim: Andre/);
    assert.match(capturedSystemPrompt, /Ingatan percakapan sebelumnya/);
});

test('contextAwareResponse remains backward compatible with old positional args', async () => {
    let capturedSystemPrompt = '';
    const askAI = async (systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return 'ok';
    };

    await contextAwareResponse('halo', askAI, 'Budi', 'memory lama');

    assert.match(capturedSystemPrompt, /Pengirim: Budi/);
    assert.match(capturedSystemPrompt, /memory lama/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/awarenessContext.test.js`

Expected: FAIL because `contextAwareResponse` does not yet accept the object form or include chat awareness.

- [x] **Step 3: Implement object input while keeping old signature**

Update `contextAwareResponse(message, askAI, senderOrOptions, memoryContextArg)` so:
- If `senderOrOptions` is an object, destructure `{ senderName, memoryContext, chatContext }`.
- Otherwise keep old behavior with positional `senderName` and `memoryContextArg`.
- Append `buildDynamicAwarenessContext(chatContext)` to the dynamic system prompt before time/memory.

- [x] **Step 4: Wire server metadata**

In `processIncomingPayload`, create:

```js
const chatContext = {
    chatType: isGroup ? 'group' : 'dm',
    chatName: isGroup ? (_data.chatName || payload.chatName || payload.chat?.name || payload._data?.chat?.name || '') : '',
    chatId,
    senderJid,
};
```

Pass it through:

```js
const askAI = makeAskAI(chatId, senderName);
reply = await handleNaturalLanguage(msgBody, chatId, senderName, askAI, chatContext);
```

Then in `handleNaturalLanguage`, call:

```js
contextAwareResponse(msg, askAI, { senderName, memoryContext, chatContext });
```

- [x] **Step 5: Run focused and full tests**

Run:
- `node --test test/awarenessContext.test.js`
- `node --test test/persistence.test.js test/bubuPersona.test.js test/systemBlocks.test.js test/awarenessContext.test.js test/reasoning.test.js test/messageTriggers.test.js test/webhookDebug.test.js`

Expected: all pass.

---

### Task 3: Live Verification and Notes

**Files:**
- Modify: `test/liveReasoning.js`
- Modify: `AWARENESS_NOTES.md`

- [x] **Step 1: Add live scenarios for DM vs group dynamic context**

Add two scenarios:
- DM context, greeting: response must not mention DM.
- Group context with name, casual greeting: response must not mention group name unless asked.

- [x] **Step 2: Run live verification**

Run: `node test/liveReasoning.js`

Expected: `Policy fails: 0`.

- [x] **Step 3: Update notes**

Mark Fase 3 complete in `AWARENESS_NOTES.md`, recording tests and any remaining deferrals:
- quoted/reply bubble stays Fase 4.
- group roster/name fetch from WAHA stays Fase 5 if no real group name is present in payload.

- [x] **Step 4: Commit phase**

Run:

```bash
git add AWARENESS_NOTES.md docs/superpowers/plans/2026-05-30-bubu-awareness-phase-3.md modules/aiAdvanced.js server.js test/awarenessContext.test.js test/liveReasoning.js
git commit -m "Complete Bubu awareness phase 3"
```
