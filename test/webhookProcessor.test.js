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
    assert.match(sent[0].text, /belum bisa DM kontak itu/);
});

test('processIncomingPayload: stores canonical sender alias in chat directory', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const { createChatDirectory } = require('../modules/chatDirectory');
    const groupId = 'directory-canonical-test@g.us';
    const directory = createChatDirectory({ storageKey: 'webhook_directory_canonical_sender' });
    directory.clear();

    const processIncoming = createWebhookProcessor({
        sendWA: async () => ({ ok: true }),
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => 'Oke',
        summarizePayload: () => ({}),
        resolveCanonicalSender: async () => '6282222222222@c.us',
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: { botIdentifiers: new Set(), recentBotMessageIds: new Set() },
        groupRosterClient: null,
        lidResolver: null,
        chatDirectory: directory,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        TARGET_GROUPS: [groupId],
        MENTION_COOLDOWN_MS: 5000,
    });

    await processIncoming({
        body: { event: 'message' },
        payload: {
            from: groupId,
            participant: '222222222222222@lid',
            body: 'bubu cek ini',
            _data: { notifyName: 'Rina' },
        },
        record: () => {},
        source: 'test',
    });

    const resolved = directory.resolveChat('222222222222222@lid');
    assert.equal(resolved.id, '6282222222222@c.us');
    assert.equal(resolved.type, 'dm');
    assert.equal(resolved.name, 'Rina');
});

test('processIncomingPayload: stores canonical sender even when message has no trigger', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const { createChatDirectory } = require('../modules/chatDirectory');
    const groupId = 'directory-no-trigger-test@g.us';
    const directory = createChatDirectory({ storageKey: 'webhook_directory_no_trigger_sender' });
    directory.clear();

    const processIncoming = createWebhookProcessor({
        sendWA: async () => ({ ok: true }),
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => 'Oke',
        summarizePayload: () => ({}),
        resolveCanonicalSender: async () => '6283333333333@c.us',
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: { botIdentifiers: new Set(), recentBotMessageIds: new Set() },
        groupRosterClient: null,
        lidResolver: null,
        chatDirectory: directory,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        TARGET_GROUPS: [groupId],
        MENTION_COOLDOWN_MS: 5000,
    });

    await processIncoming({
        body: { event: 'message' },
        payload: {
            from: groupId,
            participant: '333333333333333@lid',
            body: 'ngobrol biasa tanpa trigger',
            _data: { notifyName: 'Dina' },
        },
        record: () => {},
        source: 'test',
    });

    const resolved = directory.resolveChat('333333333333333@lid');
    assert.equal(resolved.id, '6283333333333@c.us');
    assert.equal(resolved.type, 'dm');
    assert.equal(resolved.name, 'Dina');
});

test('processIncomingPayload: keeps @semua literal without mention expansion', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const sent = [];
    const groupId = 'literal-tag-all-test@g.us';

    const processIncoming = createWebhookProcessor({
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => 'Hey @semua cek ya',
        summarizePayload: () => ({}),
        resolveCanonicalSender: async (jid) => jid,
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: { botIdentifiers: new Set(), recentBotMessageIds: new Set() },
        groupRosterClient: {
            fetchParticipants: async () => [
                { id: '628111@c.us', name: 'Andre' },
                { id: '628222@c.us', name: 'Rina' },
            ],
        },
        lidResolver: null,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        TARGET_GROUPS: [groupId],
        MENTION_COOLDOWN_MS: 5000,
    });

    await assert.doesNotReject(() => processIncoming({
        body: { event: 'message' },
        payload: {
            from: groupId,
            participant: '628333@c.us',
            body: 'bubu tag semua',
            _data: { notifyName: 'Rina' },
        },
        record: () => {},
        source: 'test',
    }));

    assert.deepEqual(sent, [{
        text: 'Hey @semua cek ya',
        chatId: groupId,
        mentions: [],
    }]);
});

test('processIncomingPayload: executes explicit outbound DM without calling AI', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const { createChatDirectory } = require('../modules/chatDirectory');
    const sent = [];
    const records = [];
    const directory = createChatDirectory({ storageKey: 'webhook_outbound_dm' });
    directory.clear();
    directory.upsertContact({ id: '6282387025429@c.us', name: 'Andre' });

    const processIncoming = createWebhookProcessor({
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        makeAskAI: () => async () => {
            throw new Error('AI should not be called for deterministic outbound');
        },
        processCommand: async () => null,
        handleNaturalLanguage: async () => {
            throw new Error('handleNaturalLanguage should not be called');
        },
        summarizePayload: () => ({}),
        resolveCanonicalSender: async (jid) => jid,
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: { botIdentifiers: new Set(), recentBotMessageIds: new Set() },
        groupRosterClient: null,
        lidResolver: null,
        chatDirectory: directory,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        TARGET_GROUPS: [],
        MENTION_COOLDOWN_MS: 5000,
    });

    await processIncoming({
        body: { event: 'message' },
        payload: {
            from: '628999000111@c.us',
            body: 'chat Andre bilang ping',
            _data: { notifyName: 'Owner' },
        },
        record: (stage, details) => records.push({ stage, details }),
        source: 'test',
    });

    assert.deepEqual(sent, [
        { text: 'ping', chatId: '6282387025429@c.us', mentions: [] },
        { text: 'Bubu udah chat Andre.', chatId: '628999000111@c.us', mentions: [] },
    ]);
    assert.ok(records.some(r => r.stage === 'test-outbound-actions-detected'));
    assert.ok(records.some(r => r.stage === 'test-outbound-actions-completed'));
});

test('processIncomingPayload: executes explicit outbound group send without calling AI', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const { createChatDirectory } = require('../modules/chatDirectory');
    const sent = [];
    const directory = createChatDirectory({ storageKey: 'webhook_outbound_group' });
    directory.clear();
    directory.upsertGroup({ id: '120363424766297041@g.us', name: 'Today' });

    const processIncoming = createWebhookProcessor({
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        makeAskAI: () => async () => {
            throw new Error('AI should not be called for deterministic outbound');
        },
        processCommand: async () => null,
        handleNaturalLanguage: async () => {
            throw new Error('handleNaturalLanguage should not be called');
        },
        summarizePayload: () => ({}),
        resolveCanonicalSender: async (jid) => jid,
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: { botIdentifiers: new Set(), recentBotMessageIds: new Set() },
        groupRosterClient: null,
        lidResolver: null,
        chatDirectory: directory,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        TARGET_GROUPS: [],
        MENTION_COOLDOWN_MS: 5000,
    });

    await processIncoming({
        body: { event: 'message' },
        payload: {
            from: '628999000111@c.us',
            body: 'kirim ke grup Today bilang @semua deploy aman',
            _data: { notifyName: 'Owner' },
        },
        record: () => {},
        source: 'test',
    });

    assert.deepEqual(sent, [
        { text: '@semua deploy aman', chatId: '120363424766297041@g.us', mentions: [] },
        { text: 'Bubu udah kirim ke grup Today.', chatId: '628999000111@c.us', mentions: [] },
    ]);
});

test('processIncomingPayload: executes explicit outbound action in target group without Bubu trigger', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const { createChatDirectory } = require('../modules/chatDirectory');
    const sent = [];
    const groupId = 'outbound-origin-group@g.us';
    const directory = createChatDirectory({ storageKey: 'webhook_outbound_group_no_trigger' });
    directory.clear();
    directory.upsertContact({ id: '6282387025429@c.us', name: 'Andre' });

    const processIncoming = createWebhookProcessor({
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        makeAskAI: () => async () => {
            throw new Error('AI should not be called for deterministic outbound');
        },
        processCommand: async () => null,
        handleNaturalLanguage: async () => {
            throw new Error('handleNaturalLanguage should not be called');
        },
        summarizePayload: () => ({}),
        resolveCanonicalSender: async (jid) => jid,
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: { botIdentifiers: new Set(), recentBotMessageIds: new Set() },
        groupRosterClient: null,
        lidResolver: null,
        chatDirectory: directory,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        TARGET_GROUPS: [groupId],
        MENTION_COOLDOWN_MS: 5000,
    });

    await processIncoming({
        body: { event: 'message' },
        payload: {
            from: groupId,
            participant: '628333@c.us',
            body: 'chat Andre bilang ping dari grup',
            _data: { notifyName: 'Owner' },
        },
        record: () => {},
        source: 'test',
    });

    assert.deepEqual(sent, [
        { text: 'ping dari grup', chatId: '6282387025429@c.us', mentions: [] },
        { text: 'Bubu udah chat Andre.', chatId: groupId, mentions: [] },
    ]);
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
