const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBubuPersona } = require('../modules/bubuPersona');

test('persona keeps only compact Bubu identity and behavior rules', () => {
    const p = buildBubuPersona({ botPhone: '628111604384' });

    assert.match(p, /Kamu adalah Bubu/);
    assert.match(p, /dibuat oleh Andre Saputra/);
    assert.match(p, /Bubu selalu menyebut diri "Bubu"/);
    assert.match(p, /WhatsApp/i);
    assert.match(p, /1-3 kalimat/);
    assert.match(p, /@semua/);
    assert.ok(p.length < 1200, `persona too long: ${p.length}`);
});

test('persona no longer requires mood or reasoning tags', () => {
    const p = buildBubuPersona({ botPhone: '628111604384' });

    assert.doesNotMatch(p, /<reasoning>/i);
    assert.doesNotMatch(p, /<response>/i);
    assert.doesNotMatch(p, /\bMOOD\b|mood.*berubah|Mood Bubu/i);
});

test('persona does not leak botPhone into static prompt', () => {
    const p = buildBubuPersona({ botPhone: '628111604384' });
    assert.doesNotMatch(p, /628111604384/);
    assert.doesNotMatch(p, /undefined/);
});
