// Smoke test: lock API surface of modules/webhookProcessor.js.
// Behavior-level regression is guarded by the existing full test suite (179+ tests).

const test = require('node:test');
const assert = require('node:assert/strict');

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
        GROUP_ID: 'test@g.us',
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
        GROUP_ID: 'expected-target@g.us',
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
