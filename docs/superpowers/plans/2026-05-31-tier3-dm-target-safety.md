# Tier-3 A — DM Target Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cegah Bubu mengirim `<dm target="...">` ke nomor/target yang dihasilkan AI tetapi tidak dikenal oleh konteks chat (roster/current sender/current DM), sambil memberi feedback aman ke chat.

**Architecture:** Tambah modul pure `modules/dmSafety.js` untuk normalisasi target dan allowlist validation. `webhookProcessor.js` memakai helper ini di dua jalur DM-tag yang sudah ada (proactive branch dan triggered branch) sebelum `sendWA(dm.message, target)`. Target DM hanya boleh dikirim jika canonical `@c.us` target ada di known targets: current DM chat, current sender, canonical sender, atau roster participants yang mentionable.

**Tech Stack:** Node.js CommonJS, node:test. Tidak ada dependency baru.

---

## File Structure

**Create:**
- `modules/dmSafety.js` — pure helper: normalize target, collect known targets, filter allowed/blocked DMs, append blocked-target notice.
- `test/dmSafety.test.js` — unit tests untuk normalisasi, allowlist, blocked notice.

**Modify:**
- `modules/webhookProcessor.js` — integrate safety check before DM sends in proactive and triggered branch.
- `test/webhookProcessor.test.js` — behavior tests for allowed DM and blocked unknown target.

---

## Task 1: Pure DM safety helper

**Files:**
- Create: `modules/dmSafety.js`
- Create: `test/dmSafety.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/dmSafety.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeDmTarget,
    collectKnownDmTargets,
    splitAllowedDMs,
    appendBlockedDmNotice,
} = require('../modules/dmSafety');

test('normalizeDmTarget converts bare phone to @c.us', () => {
    assert.equal(normalizeDmTarget('628111'), '628111@c.us');
});

test('normalizeDmTarget converts @s.whatsapp.net to @c.us', () => {
    assert.equal(normalizeDmTarget('628111@s.whatsapp.net'), '628111@c.us');
});

test('normalizeDmTarget rejects @lid and non-phone identifiers', () => {
    assert.equal(normalizeDmTarget('123@lid'), '');
    assert.equal(normalizeDmTarget('andre'), '');
});

test('collectKnownDmTargets includes current DM chat, sender, canonical sender, and roster participants', () => {
    const targets = collectKnownDmTargets({
        chatId: '628000@c.us',
        senderJid: '628111@s.whatsapp.net',
        canonicalSenderJid: '628222@c.us',
        roster: {
            participants: [
                { id: '628333@c.us', name: 'Rina' },
                { id: '123@lid', name: 'Lid User' },
            ],
        },
    });

    assert.ok(targets.has('628000@c.us'));
    assert.ok(targets.has('628111@c.us'));
    assert.ok(targets.has('628222@c.us'));
    assert.ok(targets.has('628333@c.us'));
    assert.ok(!targets.has('123@lid'));
});

test('splitAllowedDMs allows known targets and blocks unknown targets', () => {
    const knownTargets = new Set(['628111@c.us']);
    const result = splitAllowedDMs([
        { target: '628111', message: 'boleh' },
        { target: '628999', message: 'jangan' },
    ], knownTargets);

    assert.deepEqual(result.allowed, [{ target: '628111@c.us', message: 'boleh' }]);
    assert.deepEqual(result.blocked, [{ target: '628999@c.us', message: 'jangan' }]);
});

test('appendBlockedDmNotice appends notice or creates one when reply empty', () => {
    assert.equal(
        appendBlockedDmNotice('Balasan grup', [{ target: '628999@c.us', message: 'x' }]),
        'Balasan grup\n\nBubu belum bisa DM 628999@c.us karena kontaknya belum dikenal.'
    );
    assert.equal(
        appendBlockedDmNotice('', [{ target: '628999@c.us', message: 'x' }]),
        'Bubu belum bisa DM 628999@c.us karena kontaknya belum dikenal.'
    );
});

test('appendBlockedDmNotice leaves reply unchanged when nothing blocked', () => {
    assert.equal(appendBlockedDmNotice('Oke', []), 'Oke');
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/dmSafety.test.js
```

Expected: FAIL with `Cannot find module '../modules/dmSafety'`.

- [ ] **Step 3: Implement modules/dmSafety.js**

Create `modules/dmSafety.js`:

```javascript
// Safety guard for AI-emitted <dm target="..."> tags.
// Only sends DM to contacts known from current DM, current sender, canonical sender,
// or group roster participants. Unknown targets are blocked and surfaced to chat.

const normalizeDmTarget = (target) => {
    const raw = String(target || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (lower.endsWith('@lid')) return '';
    if (lower.endsWith('@s.whatsapp.net')) {
        const phone = raw.slice(0, -'@s.whatsapp.net'.length).replace(/\D/g, '');
        return phone ? `${phone}@c.us` : '';
    }
    if (lower.endsWith('@c.us')) {
        const phone = raw.slice(0, -'@c.us'.length).replace(/\D/g, '');
        return phone ? `${phone}@c.us` : '';
    }
    const phone = raw.replace(/\D/g, '');
    return phone ? `${phone}@c.us` : '';
};

const addKnown = (set, value) => {
    const normalized = normalizeDmTarget(value);
    if (normalized) set.add(normalized);
};

const collectKnownDmTargets = ({ chatId, senderJid, canonicalSenderJid, roster } = {}) => {
    const known = new Set();
    addKnown(known, chatId);
    addKnown(known, senderJid);
    addKnown(known, canonicalSenderJid);
    if (Array.isArray(roster?.participants)) {
        for (const p of roster.participants) addKnown(known, p.id);
    }
    return known;
};

const splitAllowedDMs = (dms, knownTargets) => {
    const allowed = [];
    const blocked = [];
    for (const dm of dms || []) {
        const target = normalizeDmTarget(dm.target);
        const entry = { target: target || String(dm.target || '').trim(), message: dm.message };
        if (target && knownTargets?.has(target)) allowed.push(entry);
        else blocked.push(entry);
    }
    return { allowed, blocked };
};

const appendBlockedDmNotice = (reply, blocked) => {
    if (!Array.isArray(blocked) || blocked.length === 0) return reply;
    const targets = blocked.map(dm => dm.target).filter(Boolean).join(', ') || 'target itu';
    const notice = `Bubu belum bisa DM ${targets} karena kontaknya belum dikenal.`;
    return reply ? `${reply}\n\n${notice}` : notice;
};

module.exports = {
    normalizeDmTarget,
    collectKnownDmTargets,
    splitAllowedDMs,
    appendBlockedDmNotice,
};
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/dmSafety.test.js
npm test
node -c modules/dmSafety.js
```

Expected: new test passes; deterministic suite passes.

- [ ] **Step 5: Commit**

```bash
git add modules/dmSafety.js test/dmSafety.test.js
git commit -m "feat(dm): add safety helpers for known-target validation"
```

---

## Task 2: Integrate DM safety into webhookProcessor

**Files:**
- Modify: `modules/webhookProcessor.js`
- Modify: `test/webhookProcessor.test.js`

- [ ] **Step 1: Add failing behavior tests**

Append these tests to `test/webhookProcessor.test.js` before `test.after(...)`:

```javascript
test('processIncomingPayload: blocks proactive dm to unknown target and sends notice to chat', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const { saveProactiveState, resetProactiveCooldown } = require('../modules/proactiveGuard');
    const sent = [];
    const records = [];
    const groupId = 'proactive-block-test@g.us';

    saveProactiveState(groupId, true);
    resetProactiveCooldown(groupId);

    const processIncoming = createWebhookProcessor({
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => '<dm target="628999@c.us">rahasia</dm>Balasan grup',
        summarizePayload: () => ({}),
        resolveCanonicalSender: async (jid) => jid,
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: { botIdentifiers: new Set(), recentBotMessageIds: new Set() },
        groupRosterClient: null,
        lidResolver: null,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        GROUP_ID: groupId,
        MENTION_COOLDOWN_MS: 5000,
    });

    await processIncoming({
        body: { event: 'message' },
        payload: {
            from: groupId,
            participant: '628222@c.us',
            body: 'Apa pendapat kalian soal deploy kubernetes?',
            _data: { notifyName: 'Rina' },
        },
        record: (stage, details) => records.push({ stage, details }),
        source: 'test',
    });

    assert.deepEqual(sent.map(s => s.chatId), [groupId]);
    assert.match(sent[0].text, /Balasan grup/);
    assert.match(sent[0].text, /belum bisa DM 628999@c\.us/);
    assert.ok(records.some(r => r.stage === 'test-proactive-dm-blocked'));
});

test('processIncomingPayload: allows triggered dm to roster target and blocks unknown target', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const sent = [];
    const records = [];
    const groupId = 'triggered-dm-safety@g.us';
    const roster = {
        participants: [{ id: '628111@c.us', name: 'Known' }],
    };

    const processIncoming = createWebhookProcessor({
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => '<dm target="628111@c.us">boleh</dm><dm target="628999@c.us">jangan</dm>Oke',
        summarizePayload: () => ({}),
        resolveCanonicalSender: async (jid) => jid,
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: {
            botIdentifiers: new Set(['bubu']),
            recentBotMessageIds: new Set(),
        },
        groupRosterClient: {
            fetchParticipants: async () => roster.participants,
        },
        lidResolver: null,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        GROUP_ID: groupId,
        MENTION_COOLDOWN_MS: 5000,
    });

    await processIncoming({
        body: { event: 'message' },
        payload: {
            from: groupId,
            participant: '628222@c.us',
            body: 'bubu tolong bantu',
            _data: { notifyName: 'Rina' },
        },
        record: (stage, details) => records.push({ stage, details }),
        source: 'test',
    });

    assert.equal(sent[0].chatId, '628111@c.us');
    assert.equal(sent[0].text, 'boleh');
    assert.equal(sent[1].chatId, groupId);
    assert.match(sent[1].text, /Oke/);
    assert.match(sent[1].text, /belum bisa DM 628999@c\.us/);
    assert.ok(records.some(r => r.stage === 'test-dm-blocked'));
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test test/webhookProcessor.test.js
```

Expected: new blocked tests fail because current code sends all DM tags without validation.

- [ ] **Step 3: Import dmSafety helpers in webhookProcessor**

At top of `modules/webhookProcessor.js`, after reasoning import:

```javascript
const {
    collectKnownDmTargets,
    splitAllowedDMs,
    appendBlockedDmNotice,
} = require('./dmSafety');
```

- [ ] **Step 4: Add local helper inside factory**

Inside `createWebhookProcessor`, before `return async (...) => {`, add:

```javascript
    const sendAllowedDMs = async ({ dms, knownTargets, record, source, blockedStage }) => {
        const { allowed, blocked } = splitAllowedDMs(dms, knownTargets);
        for (const dm of allowed) {
            await sendWA(dm.message, dm.target);
            record(`${source}-dm-sent`, { target: dm.target, preview: previewText(dm.message) });
        }
        if (blocked.length > 0) {
            record(`${source}-${blockedStage}`, {
                blocked: blocked.map(dm => dm.target),
            });
        }
        return { allowed, blocked };
    };
```

- [ ] **Step 5: Update proactive DM block**

Find proactive DM handling:

```javascript
                            const dms = extractDMs(reply);
                            reply = stripDMTags(reply);

                            if (dms.length > 0) {
                                record(`${source}-proactive-dms-detected`, { count: dms.length });
                                for (const dm of dms) {
                                    let target = dm.target;
                                    if (!target.includes('@')) {
                                        target += '@c.us';
                                    }
                                    await sendWA(dm.message, target);
                                    record(`${source}-proactive-dm-sent`, { target, preview: previewText(dm.message) });
                                }
                            }
```

Replace with:

```javascript
                            const dms = extractDMs(reply);
                            reply = stripDMTags(reply);

                            if (dms.length > 0) {
                                record(`${source}-proactive-dms-detected`, { count: dms.length });
                                const knownTargets = collectKnownDmTargets({
                                    chatId,
                                    senderJid,
                                    canonicalSenderJid,
                                    roster,
                                });
                                const { blocked } = await sendAllowedDMs({
                                    dms,
                                    knownTargets,
                                    record,
                                    source,
                                    blockedStage: 'proactive-dm-blocked',
                                });
                                reply = appendBlockedDmNotice(reply, blocked);
                            }
```

- [ ] **Step 6: Update triggered DM block**

Find triggered DM handling:

```javascript
            const dms = extractDMs(reply);
            reply = stripDMTags(reply);

            if (dms.length > 0) {
                record(`${source}-dms-detected`, { count: dms.length });
                for (const dm of dms) {
                    let target = dm.target;
                    if (!target.includes('@')) {
                        target += '@c.us';
                    }
                    await sendWA(dm.message, target);
                    record(`${source}-dm-sent`, { target, preview: previewText(dm.message) });
                }
            }
```

Replace with:

```javascript
            const dms = extractDMs(reply);
            reply = stripDMTags(reply);

            if (dms.length > 0) {
                record(`${source}-dms-detected`, { count: dms.length });
                const knownTargets = collectKnownDmTargets({
                    chatId,
                    senderJid,
                    canonicalSenderJid,
                    roster,
                });
                const { blocked } = await sendAllowedDMs({
                    dms,
                    knownTargets,
                    record,
                    source,
                    blockedStage: 'dm-blocked',
                });
                reply = appendBlockedDmNotice(reply, blocked);
            }
```

- [ ] **Step 7: Verify GREEN**

Run:

```bash
node --test test/webhookProcessor.test.js
npm test
node -c modules/webhookProcessor.js
```

Expected: tests pass. `npm test` should pass all deterministic tests.

- [ ] **Step 8: Commit**

```bash
git add modules/webhookProcessor.js test/webhookProcessor.test.js
git commit -m "feat(dm): block AI-emitted DMs to unknown targets"
```

---

## Self-Review

**Spec coverage:**
- Normalize/allowlist helper: Task 1.
- Integration in proactive + triggered DM branches: Task 2.
- User-visible feedback for blocked target: Task 1 helper + Task 2 integration.

**Placeholder scan:** No TODO/TBD. Code snippets are complete.

**Safety behavior:** Unknown AI target never calls `sendWA(dm.message, target)`. Known roster/current sender/current DM targets are allowed.

**Backward compatibility:** If AI emits no `<dm>` tags, behavior unchanged. If target was already known (e.g. roster participant), DM still sends.
