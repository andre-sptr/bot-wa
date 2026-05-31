// Lock API surface of modules/commands.js dan test parseWaktu (pure).

const test = require('node:test');
const assert = require('node:assert/strict');

test('commands module exports createCommandHandler and parseWaktu', () => {
    const m = require('../modules/commands');
    assert.equal(typeof m.createCommandHandler, 'function');
    assert.equal(typeof m.parseWaktu, 'function');
});

test('parseWaktu: parses minutes', () => {
    const { parseWaktu } = require('../modules/commands');
    assert.equal(parseWaktu('5m'), 5 * 60 * 1000);
});

test('parseWaktu: parses hours', () => {
    const { parseWaktu } = require('../modules/commands');
    assert.equal(parseWaktu('1h'), 60 * 60 * 1000);
});

test('parseWaktu: parses hours+minutes', () => {
    const { parseWaktu } = require('../modules/commands');
    assert.equal(parseWaktu('2h30m'), (2 * 60 + 30) * 60 * 1000);
});

test('parseWaktu: returns null for invalid input', () => {
    const { parseWaktu } = require('../modules/commands');
    assert.equal(parseWaktu('garbage'), null);
});

test('createCommandHandler returns async function', () => {
    const { createCommandHandler } = require('../modules/commands');
    const handle = createCommandHandler({
        sendWA: async () => ({ ok: true }),
        groupRosterClient: null,
    });
    assert.equal(typeof handle, 'function');
});

test('command dispatch: non-command returns null', async () => {
    const { createCommandHandler } = require('../modules/commands');
    const handle = createCommandHandler({
        sendWA: async () => ({ ok: true }),
        groupRosterClient: null,
    });
    const result = await handle('halo bukan command', 'chat@c.us', async () => 'reply');
    assert.equal(result, null);
});

test('command dispatch: /help returns help string', async () => {
    const { createCommandHandler } = require('../modules/commands');
    const handle = createCommandHandler({
        sendWA: async () => ({ ok: true }),
        groupRosterClient: null,
    });
    const result = await handle('/help', 'chat@c.us', async () => 'reply');
    assert.ok(typeof result === 'string' && result.includes('Command'));
});

test('command dispatch: /reset returns reset confirmation', async () => {
    const { createCommandHandler } = require('../modules/commands');
    const handle = createCommandHandler({
        sendWA: async () => ({ ok: true }),
        groupRosterClient: null,
    });
    const result = await handle('/reset', 'chat-reset-test@c.us', async () => 'reply');
    assert.ok(typeof result === 'string' && result.toLowerCase().includes('reset'));
});
