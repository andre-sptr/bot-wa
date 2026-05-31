// Smoke test: lock API surface of modules/crypto.js after extraction from server.js.

const test = require('node:test');
const assert = require('node:assert/strict');

test('crypto module exports getCrypto, getMultipleCrypto, getKurs, COIN_ALIAS', () => {
    const crypto = require('../modules/crypto');
    assert.equal(typeof crypto.getCrypto, 'function');
    assert.equal(typeof crypto.getMultipleCrypto, 'function');
    assert.equal(typeof crypto.getKurs, 'function');
    assert.equal(typeof crypto.COIN_ALIAS, 'object');
    assert.equal(crypto.COIN_ALIAS.btc, 'bitcoin');
    assert.equal(crypto.COIN_ALIAS.eth, 'ethereum');
});

test('getCrypto returns N/A on network failure (resilience)', async () => {
    const crypto = require('../modules/crypto');
    const result = await crypto.getCrypto('this-coin-does-not-exist-12345');
    assert.equal(result, 'N/A');
});
