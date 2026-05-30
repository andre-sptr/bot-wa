# Bubu Awareness Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Bubu aware of the quoted/replied message bubble so replies like "itu udah naik belum?" can use the bubble content even when it is outside active chat history.

**Architecture:** Keep WAHA payload parsing in `modules/messageTriggers.js` because that module already owns reply detection helpers. Pass the extracted quoted-message context through the runtime chat context from `server.js` into `contextAwareResponse`, where it becomes an uncached dynamic system block. Do not change trigger behavior or message storage shape in this phase.

**Tech Stack:** Node.js CommonJS, `node:test`, WAHA webhook payload helpers, Anthropic Messages API dynamic system blocks.

---

### Task 1: Extract Quoted Message Context From WAHA Payload

**Files:**
- Modify: `modules/messageTriggers.js`
- Modify: `test/messageTriggers.test.js`

- [x] **Step 1: Write failing tests**

Add tests for a new exported `getQuotedMessageContext(payload)` helper:

```js
test('extracts quoted message context from payload.replyTo', () => {
    const context = getQuotedMessageContext({
        replyTo: {
            body: 'Harga BTC tadi 1,7M',
            participant: '628111@c.us',
        },
    });

    assert.deepEqual(context, {
        text: 'Harga BTC tadi 1,7M',
        author: '628111@c.us',
        fromBot: false,
    });
});

test('extracts quoted message context from _data.quotedMsg', () => {
    const context = getQuotedMessageContext({
        _data: {
            quotedMsg: {
                body: 'Bubu response lama',
                fromMe: true,
                author: '628bot@c.us',
            },
        },
    });

    assert.deepEqual(context, {
        text: 'Bubu response lama',
        author: '628bot@c.us',
        fromBot: true,
    });
});

test('returns null when quoted payload has no text', () => {
    assert.equal(getQuotedMessageContext({ replyTo: { id: 'abc' } }), null);
});
```

- [x] **Step 2: Run focused test and verify RED**

Run: `node --test test/messageTriggers.test.js`

Expected: FAIL because `getQuotedMessageContext` is not exported.

- [x] **Step 3: Implement minimal extraction**

Implementation should:
- Look at `payload.replyTo`, `payload.reply_to`, `payload.quotedMsg`, and `payload._data.quotedMsg`.
- Extract text from `body`, `text`, `caption`, `_data.body`, or `_data.text`.
- Extract author from participant/from/author/id participant fields, reusing existing `normalizeContactId` where possible.
- Set `fromBot` from `fromMe === true`.
- Return `null` if text is missing.

- [x] **Step 4: Run focused test and verify GREEN**

Run: `node --test test/messageTriggers.test.js`

Expected: PASS.

---

### Task 2: Inject Quoted Context Into Dynamic Awareness

**Files:**
- Modify: `modules/aiAdvanced.js`
- Modify: `test/awarenessContext.test.js`

- [x] **Step 1: Write failing tests**

Add tests that quoted context appears in dynamic awareness and `contextAwareResponse` system prompt:

```js
test('builds quoted message awareness when reply bubble exists', () => {
    const text = buildDynamicAwarenessContext({
        chatType: 'group',
        senderName: 'Andre',
        quotedMessage: {
            text: 'Harga BTC tadi 1,7M',
            author: 'Rina',
            fromBot: false,
        },
    });

    assert.match(text, /me-reply/i);
    assert.match(text, /Harga BTC tadi 1,7M/);
    assert.match(text, /Rina/);
});

test('contextAwareResponse includes quoted message in system prompt', async () => {
    let capturedSystemPrompt = '';
    const askAI = async (systemPrompt) => {
        capturedSystemPrompt = systemPrompt;
        return 'ok';
    };

    await contextAwareResponse('itu udah naik belum?', askAI, {
        senderName: 'Andre',
        chatContext: {
            chatType: 'group',
            quotedMessage: {
                text: 'Harga BTC tadi 1,7M',
                author: 'Rina',
                fromBot: false,
            },
        },
    });

    assert.match(capturedSystemPrompt, /Harga BTC tadi 1,7M/);
    assert.match(capturedSystemPrompt, /me-reply/i);
});
```

- [x] **Step 2: Run focused test and verify RED**

Run: `node --test test/awarenessContext.test.js`

Expected: FAIL because quoted message is not yet rendered.

- [x] **Step 3: Implement quoted rendering**

Update `buildDynamicAwarenessContext`:
- Accept `quotedMessage`.
- Add one line saying the current message is replying to a previous bubble.
- Include author if available.
- Include whether the bubble was from Bubu when `fromBot` is true.
- Truncate quoted text to a bounded length to avoid prompt bloat.

- [x] **Step 4: Run focused test and verify GREEN**

Run: `node --test test/awarenessContext.test.js`

Expected: PASS.

---

### Task 3: Wire Quoted Context Through Server Runtime

**Files:**
- Modify: `server.js`
- Modify: `test/awarenessContext.test.js`

- [x] **Step 1: Write failing runtime context test**

Add a test that `buildRuntimeChatContext` carries `quotedMessage`:

```js
test('buildRuntimeChatContext includes quoted message context', () => {
    const context = buildRuntimeChatContext({
        chatId: '120@g.us',
        senderJid: '123@lid',
        payload: {
            replyTo: {
                body: 'Bubu bilang deploy sudah selesai',
                fromMe: true,
                participant: '628bot@c.us',
            },
        },
    });

    assert.deepEqual(context.quotedMessage, {
        text: 'Bubu bilang deploy sudah selesai',
        author: '628bot@c.us',
        fromBot: true,
    });
});
```

- [x] **Step 2: Run focused test and verify RED**

Run: `node --test test/awarenessContext.test.js`

Expected: FAIL because runtime context does not yet include quoted message.

- [x] **Step 3: Implement server/runtime wiring**

Either import `getQuotedMessageContext` into `modules/aiAdvanced.js` and include it in `buildRuntimeChatContext`, or compute it in `server.js` before calling `buildRuntimeChatContext`. Prefer importing into `aiAdvanced.js` so tests cover the behavior without Express.

- [x] **Step 4: Run focused and full tests**

Run:
- `node --test test/messageTriggers.test.js test/awarenessContext.test.js`
- `node --test test/persistence.test.js test/bubuPersona.test.js test/systemBlocks.test.js test/awarenessContext.test.js test/reasoning.test.js test/messageTriggers.test.js test/webhookDebug.test.js`

Expected: all pass.

---

### Task 4: Live Verification, Notes, and Commit

**Files:**
- Modify: `test/liveReasoning.js`
- Modify: `AWARENESS_NOTES.md`

- [x] **Step 1: Add live scenario**

Add a live scenario where dynamic context says the user is replying to a bubble like "Deploy staging sudah selesai", then user asks "itu udah aman belum?". Assert the response does not recite internal labels but uses the quoted content enough to answer naturally.

- [x] **Step 2: Run live verification**

Run: `node test/liveReasoning.js`

Expected: `Banlist hits: 0`, `Policy fails: 0`.

- [x] **Step 3: Update notes**

Mark Fase 4 complete in `AWARENESS_NOTES.md`. Record that quoted body is injected as dynamic context, and that roster/LID/tagging remain Fase 5/6.

- [x] **Step 4: Commit phase**

Run:

```bash
git add AWARENESS_NOTES.md docs/superpowers/plans/2026-05-30-bubu-awareness-phase-4.md modules/aiAdvanced.js modules/messageTriggers.js server.js test/awarenessContext.test.js test/liveReasoning.js test/messageTriggers.test.js
git commit -m "Complete Bubu awareness phase 4"
```
