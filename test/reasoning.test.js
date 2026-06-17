const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBubuReply, extractTag, stripTagResidue, ensureResponseSafety, extractGroupSends, stripGroupTags } = require('../modules/reasoning');

test('parses well-formed reasoning + response', () => {
    const raw = `<reasoning>
User nanya kabar, tone santai, tinggal greet aja.
</reasoning>
<response>
Halo! Bubu di sini, ada yang bisa dibantuin?
</response>`;
    const { reasoning, response } = parseBubuReply(raw);
    assert.match(reasoning, /tinggal greet aja/);
    assert.equal(response, 'Halo! Bubu di sini, ada yang bisa dibantuin?');
});

test('returns only response content when both tags present', () => {
    const raw = '<reasoning>think</reasoning><response>jawab</response>';
    const { response } = parseBubuReply(raw);
    assert.equal(response, 'jawab');
    assert.equal(response.includes('<'), false);
    assert.equal(response.includes('think'), false);
});

test('falls back gracefully when model forgets tags', () => {
    const raw = 'Halo, gue baik nih, lo gimana?';
    const { reasoning, response } = parseBubuReply(raw);
    assert.equal(reasoning, null);
    assert.equal(response, 'Halo, gue baik nih, lo gimana?');
});

test('strips orphan reasoning block when response tag missing', () => {
    const raw = `<reasoning>internal note</reasoning>
Halo! Lagi sibuk apa?`;
    const { reasoning, response } = parseBubuReply(raw);
    assert.equal(reasoning, 'internal note');
    assert.equal(response, 'Halo! Lagi sibuk apa?');
});

test('strips dangling response open/close tags without pair', () => {
    const raw = `<response>Yo gue lagi chill</response>`;
    const { reasoning, response } = parseBubuReply(raw);
    assert.equal(reasoning, null);
    assert.equal(response, 'Yo gue lagi chill');
});

test('handles multiline response content with markdown', () => {
    const raw = `<reasoning>perlu list 3 hal</reasoning>
<response>Oke nih breakdown-nya:

1. Pertama
2. Kedua
3. Ketiga

That's it!</response>`;
    const { response } = parseBubuReply(raw);
    assert.match(response, /^Oke nih breakdown-nya:/);
    assert.match(response, /That's it!$/);
    assert.match(response, /1\. Pertama/);
});

test('handles case insensitive tags', () => {
    const raw = `<Reasoning>r</Reasoning><RESPONSE>final</RESPONSE>`;
    const { reasoning, response } = parseBubuReply(raw);
    assert.equal(reasoning, 'r');
    assert.equal(response, 'final');
});

test('returns null reasoning + null-ish response for empty input', () => {
    const { reasoning, response } = parseBubuReply('');
    assert.equal(reasoning, null);
    assert.equal(response, '');
});

test('handles null input safely', () => {
    const { reasoning, response } = parseBubuReply(null);
    assert.equal(reasoning, null);
    assert.equal(response, null);
});

test('keeps angle brackets that are not tags (e.g. emoji-like text)', () => {
    const raw = `<reasoning>r</reasoning><response>Wah keren <3 banget!</response>`;
    const { response } = parseBubuReply(raw);
    assert.equal(response, 'Wah keren <3 banget!');
});

test('ignores reasoning tag inside response body', () => {
    const raw = `<reasoning>outer</reasoning><response>Bubu mikir dulu ya, soal "<reasoning>" itu tag internal kok.</response>`;
    const { reasoning, response } = parseBubuReply(raw);
    assert.equal(reasoning, 'outer');
    assert.match(response, /tag internal kok/);
});

test('extractTag returns null for missing tag', () => {
    assert.equal(extractTag('plain text', 'reasoning'), null);
    assert.equal(extractTag(null, 'reasoning'), null);
});

test('stripTagResidue handles only-tag inputs', () => {
    assert.equal(stripTagResidue('<reasoning>x</reasoning>'), '');
    assert.equal(stripTagResidue('<response>y</response>'), 'y');
});

test('whitespace around response tag is trimmed', () => {
    const raw = `<response>   \n  Halo banget!   \n  </response>`;
    const { response } = parseBubuReply(raw);
    assert.equal(response, 'Halo banget!');
});

test('ensureResponseSafety sanitizes JIDs instead of blocking normal DM confirmations', () => {
    const safe = ensureResponseSafety('Oke, Bubu DM 628111@c.us sekarang ya.', true);
    assert.match(safe, /Oke/);
    assert.match(safe, /kontak itu/);
    assert.doesNotMatch(safe, /@c\.us/);
    assert.doesNotMatch(safe, /mending kita bahas detailnya nanti/);
});

test('ensureResponseSafety still blocks raw control tags', () => {
    const safe = ensureResponseSafety('Halo <reasoning>internal</reasoning>', true);
    assert.match(safe, /mending kita bahas detailnya nanti/);
});

test('extractGroupSends parses group target and message', () => {
    const sends = extractGroupSends('Oke <group target="TODAY">@Rafly rap</group> beres');
    assert.deepEqual(sends, [{ target: 'TODAY', message: '@Rafly rap' }]);
});

test('extractGroupSends parses multiple group sends', () => {
    const sends = extractGroupSends('<group target="A">satu</group><group target="B">dua</group>');
    assert.deepEqual(sends, [
        { target: 'A', message: 'satu' },
        { target: 'B', message: 'dua' },
    ]);
});

test('extractGroupSends returns empty array when no tag present', () => {
    assert.deepEqual(extractGroupSends('cuma teks biasa'), []);
    assert.deepEqual(extractGroupSends(''), []);
});

test('stripGroupTags removes group tags and trims', () => {
    assert.equal(stripGroupTags('Oke <group target="TODAY">halo</group>'), 'Oke');
});

test('ensureResponseSafety blocks leaked group tags', () => {
    const safe = ensureResponseSafety('Halo <group target="TODAY">halo</group>', true);
    assert.match(safe, /mending kita bahas detailnya nanti/);
});
