const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeDmTarget,
    collectKnownDmTargets,
    splitAllowedDMs,
    appendBlockedDmNotice,
} = require('../modules/dmSafety');

test('normalizeDmTarget rejects bare phone numbers from AI output', () => {
    assert.equal(normalizeDmTarget('628111'), '');
});

test('normalizeDmTarget converts @s.whatsapp.net to @c.us', () => {
    assert.equal(normalizeDmTarget('628111@s.whatsapp.net'), '628111@c.us');
});

test('normalizeDmTarget rejects @lid, non-phone identifiers, and malformed JIDs', () => {
    assert.equal(normalizeDmTarget('123@lid'), '');
    assert.equal(normalizeDmTarget('andre'), '');
    assert.equal(normalizeDmTarget('abc628111@c.us'), '');
    assert.equal(normalizeDmTarget('+62 811-1@c.us'), '');
    assert.equal(normalizeDmTarget('628111<script>@c.us'), '');
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

test('splitAllowedDMs allows known explicit JIDs and blocks unknown/bare targets', () => {
    const knownTargets = new Set(['628111@c.us']);
    const result = splitAllowedDMs([
        { target: '628111@c.us', message: 'boleh' },
        { target: '628999@c.us', message: 'jangan' },
        { target: '628111', message: 'bare number blocked' },
    ], knownTargets);

    assert.deepEqual(result.allowed, [{ target: '628111@c.us', message: 'boleh' }]);
    assert.deepEqual(result.blocked, [
        { target: '628999@c.us', message: 'jangan' },
        { target: '628111', message: 'bare number blocked' },
    ]);
});

test('appendBlockedDmNotice appends notice or creates one when reply empty', () => {
    assert.equal(
        appendBlockedDmNotice('Balasan grup', [{ target: '628999@c.us', message: 'x' }]),
        'Balasan grup\n\nBubu belum bisa DM kontak itu karena kontaknya belum dikenal.'
    );
    assert.equal(
        appendBlockedDmNotice('', [{ target: '628999@c.us', message: 'x' }]),
        'Bubu belum bisa DM kontak itu karena kontaknya belum dikenal.'
    );
});

test('appendBlockedDmNotice leaves reply unchanged when nothing blocked', () => {
    assert.equal(appendBlockedDmNotice('Oke', []), 'Oke');
});
