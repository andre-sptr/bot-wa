// Gap #1 sub-step 1 — LID resolver: @lid → @c.us via WAHA /lids endpoint.
const test = require('node:test');
const assert = require('node:assert/strict');

const { createLidResolver } = require('../modules/lidResolver');

const makeResolver = (httpGet) => createLidResolver({
    wahaUrl: 'https://waha.example.com',
    session: 'BotWA',
    apiKey: 'key-1',
    httpGet,
});

// ── resolveLid ───────────────────────────────────────────────────

test('resolveLid calls /lids endpoint and returns pn', async () => {
    let capturedUrl = '';
    let capturedHeaders = {};
    const r = makeResolver(async (url, opts) => {
        capturedUrl = url;
        capturedHeaders = opts?.headers || {};
        return { data: { pn: '6285111604384@c.us' } };
    });

    const pn = await r.resolveLid('138384550936741@lid');
    assert.equal(pn, '6285111604384@c.us');
    assert.ok(capturedUrl.includes('/api/BotWA/lids/'));
    assert.ok(capturedUrl.includes('138384550936741'));
    assert.equal(capturedHeaders['X-Api-Key'], 'key-1');
});

test('resolveLid caches success (httpGet hit once for repeated lid)', async () => {
    let calls = 0;
    const r = makeResolver(async () => { calls++; return { data: { pn: '628@c.us' } }; });

    await r.resolveLid('111@lid');
    await r.resolveLid('111@lid');
    assert.equal(calls, 1);
});

test('resolveLid returns empty for non-@lid input without HTTP call', async () => {
    let calls = 0;
    const r = makeResolver(async () => { calls++; return { data: {} }; });

    assert.equal(await r.resolveLid('628@c.us'), '');
    assert.equal(calls, 0);
});

test('resolveLid returns empty on HTTP error (resilient)', async () => {
    const r = makeResolver(async () => { throw new Error('lids 500'); });
    assert.equal(await r.resolveLid('222@lid'), '');
});

// ── canonicalId ──────────────────────────────────────────────────

test('canonicalId passes through @c.us', async () => {
    const r = makeResolver(async () => ({ data: {} }));
    assert.equal(await r.canonicalId('6281234567890@c.us'), '6281234567890@c.us');
});

test('canonicalId converts @s.whatsapp.net to @c.us', async () => {
    const r = makeResolver(async () => ({ data: {} }));
    assert.equal(await r.canonicalId('6281234567890@s.whatsapp.net'), '6281234567890@c.us');
});

test('canonicalId resolves @lid to @c.us', async () => {
    const r = makeResolver(async () => ({ data: { pn: '628999@c.us' } }));
    assert.equal(await r.canonicalId('232701932138501@lid'), '628999@c.us');
});

test('canonicalId falls back to original @lid when unresolvable', async () => {
    const r = makeResolver(async () => { throw new Error('down'); });
    assert.equal(await r.canonicalId('232701932138501@lid'), '232701932138501@lid');
});

test('canonicalId handles empty input', async () => {
    const r = makeResolver(async () => ({ data: {} }));
    assert.equal(await r.canonicalId(''), '');
    assert.equal(await r.canonicalId(null), '');
});
