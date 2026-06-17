// E3 — model-initiated group send wired into webhookProcessor.
// The model emits <group target="NAME">message</group>; the system resolves NAME via the
// chat directory (known groups only), sends to the group, and reports honestly.
const test = require('node:test');
const assert = require('node:assert/strict');

const baseDeps = (overrides = {}) => ({
    makeAskAI: () => async () => 'reply',
    processCommand: async () => null,
    summarizePayload: () => ({}),
    resolveCanonicalSender: async (jid) => jid,
    hasProcessedIncoming: () => false,
    markProcessedIncoming: () => {},
    isRateLimited: () => false,
    summarizeBotState: () => ({}),
    botTriggerState: { botIdentifiers: new Set(['bubu']), recentBotMessageIds: new Set() },
    groupRosterClient: null,
    lidResolver: null,
    mentionCooldownStore: { get: () => 0, set: () => {} },
    TARGET_GROUPS: [],
    MENTION_COOLDOWN_MS: 5000,
    ...overrides,
});

test('processIncomingPayload: model sends to a known group and replies remainder to origin', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const sent = [];
    const records = [];
    const originGroup = 'origin@g.us';
    const targetGroup = '120363@g.us';

    const processIncoming = createWebhookProcessor(baseDeps({
        sendWA: async (text, chatId, mentions = []) => { sent.push({ text, chatId, mentions }); return { ok: true }; },
        handleNaturalLanguage: async () => '<group target="TODAY">@Rafly rap</group>Oke beres',
        chatDirectory: {
            upsertGroup: () => {},
            upsertContact: () => {},
            knownDmTargets: () => new Set(),
            resolveChat: (name) => name === 'TODAY'
                ? { id: targetGroup, type: 'group', name: 'TODAY', ambiguous: false }
                : null,
        },
    }));

    await processIncoming({
        body: { event: 'message' },
        payload: { from: originGroup, participant: '628222@c.us', body: 'bubu kirim halo ke grup today', _data: { notifyName: 'Andre' } },
        record: (stage, details) => records.push({ stage, details }),
        source: 'test',
    });

    const groupMsg = sent.find(s => s.chatId === targetGroup);
    assert.ok(groupMsg, 'must send to the resolved target group');
    assert.match(groupMsg.text, /rap/);

    const originMsg = sent.find(s => s.chatId === originGroup);
    assert.ok(originMsg, 'origin must get the conversational remainder');
    assert.match(originMsg.text, /Oke beres/);
    assert.doesNotMatch(originMsg.text, /<group/);
});

test('processIncomingPayload: unknown group is blocked with an honest notice, not sent', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const sent = [];
    const records = [];
    const originGroup = 'origin@g.us';

    const processIncoming = createWebhookProcessor(baseDeps({
        sendWA: async (text, chatId, mentions = []) => { sent.push({ text, chatId, mentions }); return { ok: true }; },
        handleNaturalLanguage: async () => '<group target="NGACO">halo</group>Oke',
        chatDirectory: {
            upsertGroup: () => {},
            upsertContact: () => {},
            knownDmTargets: () => new Set(),
            resolveChat: () => null,
        },
    }));

    await processIncoming({
        body: { event: 'message' },
        payload: { from: originGroup, participant: '628222@c.us', body: 'bubu kirim ke grup ngaco', _data: { notifyName: 'Andre' } },
        record: (stage, details) => records.push({ stage, details }),
        source: 'test',
    });

    // Nothing sent to any group other than the origin.
    assert.equal(sent.filter(s => s.chatId !== originGroup).length, 0);
    const originMsg = sent.find(s => s.chatId === originGroup);
    assert.ok(originMsg);
    assert.match(originMsg.text, /belum bisa kirim ke grup itu/i);
    assert.ok(records.some(r => r.stage === 'test-group-send-blocked'));
});
