// Smoke test: lock API surface of modules/webhookProcessor.js.
// Behavior-level regression is guarded by the existing full test suite (179+ tests).

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-processor-'));
process.env.BOT_DATA_DIR = tmpDir;

test('webhookProcessor exports createWebhookProcessor', () => {
    const m = require('../modules/webhookProcessor');
    assert.equal(typeof m.createWebhookProcessor, 'function');
});

test('createWebhookProcessor returns a function', () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const fn = createWebhookProcessor({
        sendWA: async () => ({ ok: true }),
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => null,
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
        TARGET_GROUPS: ['test@g.us'],
        MENTION_COOLDOWN_MS: 5000,
    });
    assert.equal(typeof fn, 'function');
});

test('processIncomingPayload: drops non-DM non-group chat with record', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const records = [];
    const record = (stage, details) => records.push({ stage, details });

    const processIncoming = createWebhookProcessor({
        sendWA: async () => ({ ok: true }),
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => null,
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
        TARGET_GROUPS: ['expected-target@g.us'],
        MENTION_COOLDOWN_MS: 5000,
    });

    // Broadcast channel — not DM, not target group → must be filtered.
    await processIncoming({
        body: { event: 'message' },
        payload: { from: 'someone@broadcast', body: 'hi' },
        record,
        source: 'test',
    });

    assert.ok(records.some(r => r.stage === 'test-chat-filtered'),
        'expected chat-filtered record for broadcast');
});

test('processIncomingPayload: proactive reply with dm tag does not throw', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const { saveProactiveState, resetProactiveCooldown } = require('../modules/proactiveGuard');
    const records = [];
    const sent = [];
    const groupId = 'proactive-dm-test@g.us';

    saveProactiveState(groupId, true);
    resetProactiveCooldown(groupId);

    const processIncoming = createWebhookProcessor({
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => '<dm target="628111@c.us">pesan rahasia</dm>Balasan grup',
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
        TARGET_GROUPS: [groupId],
        MENTION_COOLDOWN_MS: 5000,
    });

    await assert.doesNotReject(() => processIncoming({
        body: { event: 'message' },
        payload: {
            from: groupId,
            participant: '628222@c.us',
            body: 'Apa pendapat kalian soal deploy kubernetes?',
            _data: { notifyName: 'Rina' },
        },
        record: (stage, details) => records.push({ stage, details }),
        source: 'test',
    }));

    // Tier-3 A: 628111 is neither the sender nor a roster member → DM blocked,
    // and the reply to the group carries a notice instead of a silent DM.
    assert.deepEqual(sent.map(s => s.chatId), [groupId]);
    assert.match(sent[0].text, /Balasan grup/);
    assert.match(sent[0].text, /belum bisa DM 628111@c\.us/);
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
