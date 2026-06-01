const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeDmTarget,
    collectKnownDmTargets,
    splitAllowedDMs,
    appendBlockedDmNotice,
} = require('../modules/dmSafety');

test('normalizeDmTarget converts bare phone to @c.us', () => {
    assert.equal(normalizeDmTarget('628111'), '628111@c.us');
});

test('normalizeDmTarget converts @s.whatsapp.net to @c.us', () => {
    assert.equal(normalizeDmTarget('628111@s.whatsapp.net'), '628111@c.us');
});

test('normalizeDmTarget rejects @lid and non-phone identifiers', () => {
    assert.equal(normalizeDmTarget('123@lid'), '');
    assert.equal(normalizeDmTarget('andre'), '');
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

test('splitAllowedDMs allows known targets and blocks unknown targets', () => {
    const knownTargets = new Set(['628111@c.us']);
    const result = splitAllowedDMs([
        { target: '628111', message: 'boleh' },
        { target: '628999', message: 'jangan' },
    ], knownTargets);

    assert.deepEqual(result.allowed, [{ target: '628111@c.us', message: 'boleh' }]);
    assert.deepEqual(result.blocked, [{ target: '628999@c.us', message: 'jangan' }]);
});

test('appendBlockedDmNotice appends notice or creates one when reply empty', () => {
    assert.equal(
        appendBlockedDmNotice('Balasan grup', [{ target: '628999@c.us', message: 'x' }]),
        'Balasan grup\n\nBubu belum bisa DM 628999@c.us karena kontaknya belum dikenal.'
    );
    assert.equal(
        appendBlockedDmNotice('', [{ target: '628999@c.us', message: 'x' }]),
        'Bubu belum bisa DM 628999@c.us karena kontaknya belum dikenal.'
    );
});

test('appendBlockedDmNotice leaves reply unchanged when nothing blocked', () => {
    assert.equal(appendBlockedDmNotice('Oke', []), 'Oke');
});
