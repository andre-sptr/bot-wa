const test = require('node:test');
const assert = require('node:assert/strict');
const {
    asSerializedId,
    normalizeContactId,
    parseSerializedMessageId,
    normalizeWahaMessage,
} = require('../modules/wahaIdentity');
const wahaSendDm = require('./fixtures/waha-send-dm.json');
const wahaSendGroup = require('./fixtures/waha-send-group.json');
const wahaChatsSummary = require('./fixtures/waha-chats-summary.json');

test('asSerializedId extracts _serialized from WAHA id object', () => {
    assert.equal(asSerializedId({ _serialized: '232701932138501@lid' }), '232701932138501@lid');
});

test('normalizeContactId converts s.whatsapp.net to c.us', () => {
    assert.equal(normalizeContactId('6282387025429@s.whatsapp.net'), '6282387025429@c.us');
});

test('parseSerializedMessageId ignores self-DM _out suffix as participant', () => {
    const parsed = parseSerializedMessageId('true_138384550936741@lid_3EB01D7751A9FAB0FAB886_out');
    assert.equal(parsed.fromMe, true);
    assert.equal(parsed.remote, '138384550936741@lid');
    assert.equal(parsed.messageId, '3EB01D7751A9FAB0FAB886');
    assert.equal(parsed.participant, '');
});

test('parseSerializedMessageId rejects malformed out contact suffix as participant', () => {
    const parsed = parseSerializedMessageId('true_138384550936741@lid_3EB01D7751A9FAB0FAB886_out@c.us');
    assert.equal(parsed.participant, '');
});

test('parseSerializedMessageId keeps group participant lid', () => {
    const parsed = parseSerializedMessageId('true_120363424766297041@g.us_3EB02C8F249243772F62BF_138384550936741@lid');
    assert.equal(parsed.remote, '120363424766297041@g.us');
    assert.equal(parsed.participant, '138384550936741@lid');
});

test('normalizeWahaMessage uses outgoing DM target from to field', () => {
    const msg = normalizeWahaMessage({
        fromMe: true,
        id: {
            fromMe: true,
            remote: '232701932138501@lid',
            id: '3EB044DD918C5533BB16F4',
            _serialized: 'true_232701932138501@lid_3EB044DD918C5533BB16F4',
        },
        from: '138384550936741@lid',
        to: '232701932138501@lid',
        body: 'Bubu test',
        type: 'chat',
    });
    assert.equal(msg.chatId, '232701932138501@lid');
    assert.equal(msg.senderJid, '138384550936741@lid');
    assert.equal(msg.fromMe, true);
});

test('normalizeWahaMessage handles sanitized WAHA outgoing DM fixture', () => {
    const msg = normalizeWahaMessage(wahaSendDm);
    assert.equal(msg.chatId, '232701932138501@lid');
    assert.equal(msg.senderJid, '138384550936741@lid');
    assert.equal(msg.messageId, '3EB044DD918C5533BB16F4');
    assert.equal(msg.chatType, 'dm');
    assert.equal(msg.fromMe, true);
});

test('normalizeWahaMessage handles sanitized WAHA outgoing group fixture', () => {
    const msg = normalizeWahaMessage(wahaSendGroup);
    assert.equal(msg.chatId, '120363424766297041@g.us');
    assert.equal(msg.senderJid, '138384550936741@lid');
    assert.equal(msg.participant, '138384550936741@lid');
    assert.equal(msg.messageId, '3EB02C8F249243772F62BF');
    assert.equal(msg.chatType, 'group');
    assert.equal(msg.fromMe, true);
});

test('waha chats summary fixture preserves DM lid and group ids', () => {
    assert.equal(asSerializedId(wahaChatsSummary[0].id), '232701932138501@lid');
    assert.equal(asSerializedId(wahaChatsSummary[1].id), '120363424766297041@g.us');
    assert.equal(wahaChatsSummary[1].groupMetadata.participants[0].id._serialized, '6282387025429@c.us');
});
