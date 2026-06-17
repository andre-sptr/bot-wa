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

test('parseOutboundRequests accepts Bubu prefix before chat intent', () => {
    const actions = parseOutboundRequests('Bubu, chat Andre bilang meeting jam 3');
    assert.deepEqual(actions, [{ type: 'send_dm', targetText: 'Andre', message: 'meeting jam 3' }]);
});

test('parseOutboundRequests detects group send intent', () => {
    const actions = parseOutboundRequests('kirim ke grup Today bilang deploy aman');
    assert.deepEqual(actions, [{ type: 'send_group', targetText: 'Today', message: 'deploy aman' }]);
});

test('parseOutboundRequests detects chat grup intent', () => {
    const actions = parseOutboundRequests('chat grup Today bilang deploy aman');
    assert.deepEqual(actions, [{ type: 'send_group', targetText: 'Today', message: 'deploy aman' }]);
});

test('parseOutboundRequests detects kirim pesan ke intent', () => {
    const actions = parseOutboundRequests('kirim pesan ke Andre bilang meeting jam 3');
    assert.deepEqual(actions, [{ type: 'send_dm', targetText: 'Andre', message: 'meeting jam 3' }]);
});

test('parseOutboundRequests detects bilangin intent', () => {
    const actions = parseOutboundRequests('bilangin Andre jangan lupa meeting');
    assert.deepEqual(actions, [{ type: 'send_dm', targetText: 'Andre', message: 'jangan lupa meeting' }]);
});

test('parseOutboundRequests ignores vague chat text without message body', () => {
    assert.deepEqual(parseOutboundRequests('chat Andre'), []);
    assert.deepEqual(parseOutboundRequests('nanti aku chat Andre'), []);
});

test('executeOutboundRequests sends resolved target and origin confirmation', async () => {
    const sent = [];
    const directory = {
        resolveChat: (target) => target === 'Andre'
            ? { id: '6282387025429@c.us', type: 'dm', name: 'Andre', ambiguous: false }
            : null,
    };
    const result = await executeOutboundRequests({
        actions: [{ type: 'send_dm', targetText: 'Andre', message: 'ping' }],
        directory,
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        originChatId: '120@g.us',
    });

    assert.equal(result.sent.length, 1);
    assert.deepEqual(sent, [
        { text: 'ping', chatId: '6282387025429@c.us', mentions: [] },
        { text: 'Bubu udah chat Andre.', chatId: '120@g.us', mentions: [] },
    ]);
});

test('executeOutboundRequests sends group target and origin confirmation', async () => {
    const sent = [];
    const directory = {
        resolveChat: (target) => target === 'Today'
            ? { id: '120363424766297041@g.us', type: 'group', name: 'Today', ambiguous: false }
            : null,
    };
    const result = await executeOutboundRequests({
        actions: [{ type: 'send_group', targetText: 'Today', message: '@semua deploy aman' }],
        directory,
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        originChatId: '628owner@c.us',
    });

    assert.equal(result.sent.length, 1);
    assert.deepEqual(sent, [
        { text: '@semua deploy aman', chatId: '120363424766297041@g.us', mentions: [] },
        { text: 'Bubu udah kirim ke grup Today.', chatId: '628owner@c.us', mentions: [] },
    ]);
});

test('executeOutboundRequests does not confirm success when target send fails', async () => {
    const sent = [];
    const directory = {
        resolveChat: (target) => target === 'Andre'
            ? { id: '6282387025429@c.us', type: 'dm', name: 'Andre', ambiguous: false }
            : null,
    };
    const result = await executeOutboundRequests({
        actions: [{ type: 'send_dm', targetText: 'Andre', message: 'ping' }],
        directory,
        sendWA: async (text, chatId) => {
            sent.push({ text, chatId });
            if (chatId === '6282387025429@c.us') return { ok: false, error: { message: 'not on whatsapp' } };
            return { ok: true };
        },
        originChatId: '120@g.us',
    });

    assert.equal(result.sent.length, 0, 'failed send must not be counted as sent');
    assert.equal(result.failed.length, 1, 'failed send must be recorded');
    assert.equal(sent[0].chatId, '6282387025429@c.us', 'target send should be attempted');

    const originMsg = sent.find(item => item.chatId === '120@g.us');
    assert.ok(originMsg, 'origin must be notified of the failure');
    assert.doesNotMatch(originMsg.text, /udah chat|udah kirim/i, 'must not claim success');
    assert.match(originMsg.text, /gagal/i, 'must honestly report failure');
});

test('executeOutboundRequests reports unresolved and ambiguous targets without sending target message', async () => {
    const sent = [];
    const directory = {
        resolveChat: (target) => {
            if (target === 'Andre') return {
                id: '',
                type: 'ambiguous',
                name: 'Andre',
                ambiguous: true,
                matches: [
                    { id: '628111@c.us', type: 'dm', name: 'Andre A' },
                    { id: '120@g.us', type: 'group', name: 'Andre Group' },
                ],
            };
            return null;
        },
    };
    const result = await executeOutboundRequests({
        actions: [
            { type: 'send_dm', targetText: 'Andre', message: 'ping' },
            { type: 'send_dm', targetText: 'Rina', message: 'ping' },
        ],
        directory,
        sendWA: async (text, chatId, mentions = []) => {
            sent.push({ text, chatId, mentions });
            return { ok: true };
        },
        originChatId: 'origin@g.us',
    });

    assert.equal(result.sent.length, 0);
    assert.equal(result.blocked.length, 2);
    assert.deepEqual(sent.map(item => item.chatId), ['origin@g.us', 'origin@g.us']);
    assert.match(sent[0].text, /terlalu banyak pilihan.*Andre/i);
    assert.match(sent[1].text, /belum nemu.*Rina/i);
});
