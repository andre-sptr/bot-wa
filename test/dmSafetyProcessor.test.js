// Tier-3 A integration — DM safety wired into webhookProcessor (triggered branch).
// Allowed: target present in the group roster. Blocked: unknown target, with a
// user-facing notice appended to the chat reply instead of a silent DM.
const test = require('node:test');
const assert = require('node:assert/strict');

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
        TARGET_GROUPS: [groupId],
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
