const test = require('node:test');
const assert = require('node:assert/strict');

const { buildBubuPersona } = require('../modules/bubuPersona');

test('menyertakan identitas Bubu dan pembuat (Andre Saputra)', () => {
    const p = buildBubuPersona({ botPhone: '628111604384' });
    assert.match(p, /Bubu/i);
    assert.match(p, /Andre Saputra/i);
});

test('menyertakan kesadaran medium: WhatsApp + WAHA', () => {
    const p = buildBubuPersona({ botPhone: '628111604384' });
    assert.match(p, /WhatsApp/i);
    assert.match(p, /WAHA/i);
});

test('menyertakan nomor WA Bubu kalau dikasih', () => {
    const p = buildBubuPersona({ botPhone: '628111604384' });
    assert.match(p, /628111604384/);
});

test('menyertakan ATURAN #1 anti-recite (tau konteks, jangan umumin)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /jangan.*umumin|bukan.*diucapin|LENSA/i);
});

test('menyertakan sikap KEPO (follow-up question)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /KEPO/i);
    assert.match(p, /follow-up|tanya.*balik|penasaran/i);
});

test('menyertakan sikap SOTOY (playful, roast ringan)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /SOTOY/i);
    assert.match(p, /roast|playful|sok tau/i);
});

test('menyertakan PUNYA OPINI (ga cuma netral)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /OPINI/i);
    assert.match(p, /pendapat|sisi|ga cuma jawab/i);
});

test('menyertakan MOOD awareness', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /MOOD|mood.*berubah/i);
    assert.match(p, /excited|chill|sleepy|bete|hype|bosan/i);
});

test('menyertakan aturan bahasa Jaksel (~80% Indo, ~20% English)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /80%.*Indo|Bahasa Indonesia/i);
    assert.match(p, /literally|honestly|basically|actually|kinda|ngl|tbh/i);
});

test('mempertahankan format reasoning/response (gut check)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /<reasoning>/);
    assert.match(p, /<response>/);
    // Gut check style: 1-2 baris, no checklist
    assert.match(p, /gut check|1-2 baris/i);
});

test('mempertahankan aturan lama (emoji & panjang)', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /emoji/i);
    assert.match(p, /1-3 kalimat/i);
});

test('honest-AI: jujur ngaku asisten digital kalau ditanya', () => {
    const p = buildBubuPersona({ botPhone: '628' });
    assert.match(p, /asisten digital/i);
});

test('tanpa botPhone: tetap valid, tidak ada "undefined" bocor', () => {
    const p = buildBubuPersona();
    assert.ok(p.length > 0);
    assert.match(p, /WhatsApp/i);
    assert.doesNotMatch(p, /undefined/);
});
