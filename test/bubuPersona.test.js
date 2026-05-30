const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBubuPersona } = require('../modules/bubuPersona');

test('menyertakan kesadaran medium: WhatsApp + WAHA', () => {
    const p = buildBubuPersona({ botPhone: '628111604384' });
    assert.match(p, /WhatsApp/i);
    assert.match(p, /WAHA/);
});

test('menyertakan nomor WA Bubu kalau dikasih', () => {
    const p = buildBubuPersona({ botPhone: '628111604384' });
    assert.match(p, /628111604384/);
});

test('menyertakan pembuat (Andre)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /Andre/);
});

test('menyertakan ATURAN #1 anti-recite (tau konteks, jangan umumin)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /jangan.*umumin|jangan diumumin|bukan.*diumumin/i);
});

test('menyertakan patokan kanonik: tau grup mana tapi ga sebut kalau ga ditanya', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /grup mana|nama grup/i);
});

test('honest-AI: jujur ngaku asisten digital kalau ditanya', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /asisten digital/i);
});

test('mempertahankan format reasoning/response', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /<reasoning>/);
    assert.match(p, /<response>/);
});

test('mempertahankan aturan lama (emoji & panjang)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /emoji/i);
    assert.match(p, /1-3 kalimat|kalimat/i);
});

test('tanpa botPhone: tetap valid, tidak ada "undefined" bocor', () => {
    const p = buildBubuPersona();
    assert.ok(p.length > 0);
    assert.match(p, /WhatsApp/i);
    assert.doesNotMatch(p, /undefined/);
});
