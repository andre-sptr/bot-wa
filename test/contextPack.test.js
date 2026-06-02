const test = require('node:test');
const assert = require('node:assert/strict');
const { buildContextPack, renderContextPackForPrompt } = require('../modules/contextPack');

test('buildContextPack derives DM metadata correctly', () => {
    const pack = buildContextPack({
        chatId: '628123@c.us',
        senderJid: '628123@c.us',
        senderName: 'Andre',
        payload: {},
        messageText: 'halo',
    });
    assert.equal(pack.chat.type, 'dm');
    assert.equal(pack.chat.id, '628123@c.us');
    assert.equal(pack.sender.name, 'Andre');
    assert.equal(pack.message.text, 'halo');
});

test('buildContextPack derives group metadata with name from payload', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        senderJid: '123@lid',
        senderName: 'Rina',
        payload: { chatName: 'Draft Awareness' },
        messageText: 'tes',
        roster: { participants: [{ id: '123@lid', name: 'Rina' }] },
    });
    assert.equal(pack.chat.type, 'group');
    assert.equal(pack.chat.name, 'Draft Awareness');
    assert.ok(pack.roster);
    assert.equal(pack.roster.participantCount, 1);
});

test('buildContextPack includes quoted message context', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        senderJid: '628bot@c.us',
        payload: {
            replyTo: {
                body: 'Bubu bilang deploy sudah selesai',
                fromMe: true,
                participant: '628bot@c.us',
            },
        },
    });
    assert.ok(pack.message.quoted);
    assert.equal(pack.message.quoted.text, 'Bubu bilang deploy sudah selesai');
    assert.equal(pack.message.quoted.fromBot, true);
});

test('buildContextPack includes time block with Jakarta timezone', () => {
    const pack = buildContextPack({ chatId: '120@g.us' });
    assert.ok(pack.time.jakarta);
    assert.ok(pack.time.dayName);
    assert.ok(pack.time.greeting);
    assert.ok(typeof pack.time.hour === 'number');
});

test('renderContextPackForPrompt renders DM awareness without leaking', () => {
    const pack = buildContextPack({
        chatId: '628123@c.us',
        senderJid: '628123@c.us',
        senderName: 'Andre',
        payload: {},
        messageText: 'halo',
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /chat pribadi \(DM\)/i);
    assert.doesNotMatch(rendered, /undefined|null/);
});

test('renderContextPackForPrompt renders group awareness with [privat] rule', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        senderJid: '123@lid',
        senderName: 'Rina',
        payload: {},
        messageText: 'halo',
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /\[privat\]/);
    assert.match(rendered, /Tipe chat: grup/i);
});

test('renderContextPackForPrompt includes proactive instructions', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        messageText: 'halo',
        proactiveMode: true,
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /MODE PROAKTIF/);
    assert.match(rendered, /\[SKIP\]/);
});

test('renderContextPackForPrompt includes roster summary when available', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        roster: { participants: [{ id: '1@lid', name: 'Andre' }, { id: '2@lid', name: 'Budi' }] },
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /2 anggota/);
    assert.match(rendered, /Andre/);
});

test('renderContextPackForPrompt includes quoted message text', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        payload: {
            replyTo: {
                body: 'Harga BTC tadi 1,7M',
                author: 'Rina',
                fromMe: false,
            },
        },
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /Harga BTC tadi 1,7M/);
    assert.match(rendered, /dari rina/i);
});

test('renderContextPackForPrompt truncates long quoted messages', () => {
    const longText = 'x'.repeat(600);
    const pack = buildContextPack({
        chatId: '120@g.us',
        payload: {
            replyTo: {
                body: longText,
                fromMe: false,
                participant: '123@lid',
            },
        },
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.ok(rendered.includes('…'));
    assert.ok(!rendered.includes('x'.repeat(550)));
});

test('renderContextPackForPrompt includes memory context when available', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        messageText: 'yang kemarin itu gimana?',
    });
    const rendered = renderContextPackForPrompt(pack);
    if (pack.memory?.relevant) {
        assert.match(rendered, /Ingatan percakapan sebelumnya/);
        assert.match(rendered, /\[/);
    }
});

test('renderContextPackForPrompt includes operational time context', () => {
    const pack = buildContextPack({ chatId: '120@g.us' });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /Konteks operasional/);
    assert.match(rendered, /Waktu:/);
    assert.match(rendered, /Hari:/);
    assert.match(rendered, /Sesi:/);
});
