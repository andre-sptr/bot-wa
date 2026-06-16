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

test('renderContextPackForPrompt renders compact DM awareness without leaking nulls', () => {
    const pack = buildContextPack({
        chatId: '628123@c.us',
        senderJid: '628123@c.us',
        senderName: 'Andre',
        payload: {},
        messageText: 'halo',
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /Runtime context, do not announce:/);
    assert.match(rendered, /chat\.type=dm/);
    assert.match(rendered, /sender\.name=Andre/);
    assert.match(rendered, /sender\.id=628123@c\.us/);
    assert.doesNotMatch(rendered, /undefined|null/);
});

test('renderContextPackForPrompt renders compact group awareness with privacy rule', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        senderJid: '123@lid',
        senderName: 'Rina',
        payload: { chatName: 'Draft Awareness' },
        messageText: 'halo',
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /chat\.type=group/);
    assert.match(rendered, /chat\.name=Draft Awareness/);
    assert.match(rendered, /privacy=private memories stay private/);
});

test('renderContextPackForPrompt includes proactive instructions', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        messageText: 'halo',
        proactiveMode: true,
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /mode\.proactive=true/);
    assert.match(rendered, /\[SKIP\]/);
});

test('renderContextPackForPrompt includes roster summary when available', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        roster: {
            participants: [
                { id: '628111@c.us', name: 'Andre' },
                { id: '628222@c.us', name: 'Budi' },
            ],
        },
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /roster\.count=2/);
    assert.match(rendered, /roster\.members=Andre:628111@c\.us, Budi:628222@c\.us/);
    assert.match(rendered, /capabilities=send_dm, send_group, mention_user, tag_all_literal/);
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
    assert.match(rendered, /message\.replyTo\.text=Harga BTC tadi 1,7M/);
    assert.match(rendered, /message\.replyTo\.author=Rina/);
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
    assert.ok(rendered.includes('...'));
    assert.ok(!rendered.includes('x'.repeat(550)));
});

test('renderContextPackForPrompt includes memory context when available', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        messageText: 'yang kemarin itu gimana?',
    });
    const rendered = renderContextPackForPrompt(pack);
    if (pack.memory?.relevant) {
        assert.match(rendered, /memory\.relevant=/);
        assert.match(rendered, /\[/);
    }
});

test('renderContextPackForPrompt includes compact time context', () => {
    const pack = buildContextPack({ chatId: '120@g.us' });
    const rendered = renderContextPackForPrompt(pack);
    assert.match(rendered, /time\.jakarta=/);
    assert.match(rendered, /time\.day=/);
    assert.match(rendered, /time\.greeting=/);
});

test('renderContextPackForPrompt includes current sender canonical id without dm tag instructions', () => {
    const pack = buildContextPack({
        chatId: '120@g.us',
        senderJid: '123@lid',
        canonicalSenderJid: '628222@c.us',
        senderName: 'Rina',
        messageText: 'dm gue nanti ya',
    });
    const rendered = renderContextPackForPrompt(pack);
    assert.equal(pack.sender.canonicalJid, '628222@c.us');
    assert.match(rendered, /sender\.id=628222@c\.us/);
    assert.doesNotMatch(rendered, /<dm target=/);
});
