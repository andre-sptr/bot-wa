// Fase 6 — Tagging beneran: mention helper.
// TDD RED: tests written BEFORE implementation. All should fail until mentionHelper.js exists.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    phoneMentionable,
    extractMentionIntents,
    formatMentionedReply,
    guardMentions,
} = require('../modules/mentionHelper');

// ── Sample roster participants (from Fase 5 groupRoster) ─────────

const ROSTER = [
    { id: '6281234567890@c.us', role: 'admin', name: 'Andre' },
    { id: '6289999888877@c.us', role: 'participant', name: 'Rina' },
    { id: '6287777666655@c.us', role: 'participant', name: 'Budi Setiawan' },
    { id: '138384550936741@lid', role: 'participant', name: 'Dina' },
    { id: '6285555444433@c.us', role: 'participant', name: '' },  // no name
];

// ── phoneMentionable ─────────────────────────────────────────────

test('phoneMentionable returns phone and jid for @c.us ID', () => {
    const result = phoneMentionable('6281234567890@c.us');
    assert.equal(result.phone, '6281234567890');
    assert.equal(result.jid, '6281234567890@c.us');
});

test('phoneMentionable returns null for @lid ID', () => {
    const result = phoneMentionable('138384550936741@lid');
    assert.equal(result, null);
});

test('phoneMentionable returns null for empty/invalid input', () => {
    assert.equal(phoneMentionable(''), null);
    assert.equal(phoneMentionable(null), null);
    assert.equal(phoneMentionable(undefined), null);
});

test('phoneMentionable handles @s.whatsapp.net as mentionable', () => {
    const result = phoneMentionable('628111@s.whatsapp.net');
    assert.equal(result.phone, '628111');
    assert.equal(result.jid, '628111@c.us');
});

// ── extractMentionIntents ────────────────────────────────────────

test('extractMentionIntents finds @Name match in roster by name', () => {
    const intents = extractMentionIntents('Eh @Andre cek dong', ROSTER);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].matchedText, '@Andre');
    assert.equal(intents[0].participant.id, '6281234567890@c.us');
});

test('extractMentionIntents is case-insensitive for name matching', () => {
    const intents = extractMentionIntents('Hey @rina gimana?', ROSTER);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].participant.name, 'Rina');
});

test('extractMentionIntents matches multi-word name (first word)', () => {
    const intents = extractMentionIntents('@Budi tolong cek', ROSTER);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].participant.name, 'Budi Setiawan');
});

test('extractMentionIntents matches phone number directly', () => {
    const intents = extractMentionIntents('Tag @6289999888877 ya', ROSTER);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].participant.id, '6289999888877@c.us');
});

test('extractMentionIntents finds multiple mentions in one text', () => {
    const intents = extractMentionIntents('@Andre dan @Rina tolong', ROSTER);
    assert.equal(intents.length, 2);
});

test('extractMentionIntents returns empty for no matches', () => {
    const intents = extractMentionIntents('Tidak ada tag disini', ROSTER);
    assert.equal(intents.length, 0);
});

test('extractMentionIntents returns empty for unrecognized @name', () => {
    const intents = extractMentionIntents('@SiapaSih tolong', ROSTER);
    assert.equal(intents.length, 0);
});

test('extractMentionIntents handles empty roster gracefully', () => {
    const intents = extractMentionIntents('@Andre hello', []);
    assert.equal(intents.length, 0);
});

test('extractMentionIntents deduplicates same person tagged twice', () => {
    const intents = extractMentionIntents('@Andre hey @Andre', ROSTER);
    assert.equal(intents.length, 1);
});

// ── BUG FIX: trailing punctuation ───────────────────────────────

test('extractMentionIntents strips trailing comma from @Name,', () => {
    const intents = extractMentionIntents('Hey @Andre, cek dong ya!', ROSTER);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].participant.name, 'Andre');
});

test('extractMentionIntents strips trailing period from @Name.', () => {
    const intents = extractMentionIntents('Udah kirim ke @Rina.', ROSTER);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].participant.name, 'Rina');
});

test('extractMentionIntents strips trailing exclamation from @Name!', () => {
    const intents = extractMentionIntents('Mana @Budi! Telat terus', ROSTER);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].participant.name, 'Budi Setiawan');
});

test('extractMentionIntents strips trailing question mark from @Name?', () => {
    const intents = extractMentionIntents('Mau ikut ga @Andre?', ROSTER);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].participant.name, 'Andre');
});

test('extractMentionIntents handles @Name with multiple trailing punctuation', () => {
    const intents = extractMentionIntents('Serius @Rina??', ROSTER);
    assert.equal(intents.length, 1);
    assert.equal(intents[0].participant.name, 'Rina');
});

// ── TAG ALL ─────────────────────────────────────────────────────

test('extractMentionIntents with @all returns all mentionable participants', () => {
    const intents = extractMentionIntents('Hey @all cek semua', ROSTER);
    // Should include all mentionable (@c.us) participants, NOT @lid
    const mentionableCount = ROSTER.filter(p => phoneMentionable(p.id)).length;
    assert.equal(intents.length, mentionableCount);
    // All should be tagged via '@all' matchedText
    assert.ok(intents.every(i => i.matchedText === '@all'));
});

test('extractMentionIntents with @semua returns all mentionable participants', () => {
    const intents = extractMentionIntents('Hey @semua cek ya', ROSTER);
    const mentionableCount = ROSTER.filter(p => phoneMentionable(p.id)).length;
    assert.equal(intents.length, mentionableCount);
});

test('extractMentionIntents with @everyone returns all mentionable participants', () => {
    const intents = extractMentionIntents('@everyone meeting jam 3', ROSTER);
    const mentionableCount = ROSTER.filter(p => phoneMentionable(p.id)).length;
    assert.equal(intents.length, mentionableCount);
});

test('extractMentionIntents with @all excludes @lid participants', () => {
    const intents = extractMentionIntents('Hey @all', ROSTER);
    const lidParticipant = intents.find(i => i.participant.id === '138384550936741@lid');
    assert.equal(lidParticipant, undefined);
});

test('extractMentionIntents with @Name + @all deduplicates', () => {
    const intents = extractMentionIntents('@Andre tolong @all juga', ROSTER);
    // Andre should NOT be duplicated — he's already in the individual mention
    const andreCount = intents.filter(i => i.participant.id === '6281234567890@c.us').length;
    assert.equal(andreCount, 1);
    // But all others should be included
    const mentionableCount = ROSTER.filter(p => phoneMentionable(p.id)).length;
    assert.equal(intents.length, mentionableCount);
});

// ── formatMentionedReply ─────────────────────────────────────────

test('formatMentionedReply replaces @Name with @phone and builds mentions array', () => {
    const intents = [
        { matchedText: '@Andre', participant: { id: '6281234567890@c.us', name: 'Andre' } },
    ];
    const result = formatMentionedReply('Eh @Andre cek dong', intents);
    assert.equal(result.text, 'Eh @6281234567890 cek dong');
    assert.deepEqual(result.mentions, ['6281234567890@c.us']);
});

test('formatMentionedReply handles multiple mentions', () => {
    const intents = [
        { matchedText: '@Andre', participant: { id: '6281234567890@c.us', name: 'Andre' } },
        { matchedText: '@Rina', participant: { id: '6289999888877@c.us', name: 'Rina' } },
    ];
    const result = formatMentionedReply('@Andre dan @Rina tolong', intents);
    assert.ok(result.text.includes('@6281234567890'));
    assert.ok(result.text.includes('@6289999888877'));
    assert.equal(result.mentions.length, 2);
});

test('formatMentionedReply skips @lid participants (not mentionable)', () => {
    const intents = [
        { matchedText: '@Dina', participant: { id: '138384550936741@lid', name: 'Dina' } },
    ];
    const result = formatMentionedReply('Hey @Dina', intents);
    // Text keeps @Dina as-is (not replaced), no mentions
    assert.equal(result.text, 'Hey @Dina');
    assert.equal(result.mentions.length, 0);
});

test('formatMentionedReply returns empty mentions when no intents', () => {
    const result = formatMentionedReply('No tags here', []);
    assert.equal(result.text, 'No tags here');
    assert.deepEqual(result.mentions, []);
});

test('formatMentionedReply handles @all intents correctly', () => {
    const intents = [
        { matchedText: '@all', participant: { id: '6281234567890@c.us', name: 'Andre' } },
        { matchedText: '@all', participant: { id: '6289999888877@c.us', name: 'Rina' } },
    ];
    const result = formatMentionedReply('Hey @all cek', intents);
    // @all should be replaced with @phone1 @phone2
    assert.ok(result.text.includes('@6281234567890'));
    assert.ok(result.text.includes('@6289999888877'));
    assert.equal(result.mentions.length, 2);
    assert.ok(result.mentions.includes('6281234567890@c.us'));
    assert.ok(result.mentions.includes('6289999888877@c.us'));
});

// ── guardMentions ────────────────────────────────────────────────

test('guardMentions caps mentions to maxPerMessage', () => {
    const input = ['a@c.us', 'b@c.us', 'c@c.us', 'd@c.us', 'e@c.us', 'f@c.us'];
    const result = guardMentions(input, 3);
    assert.equal(result.length, 3);
});

test('guardMentions filters out non-JID strings', () => {
    const input = ['plain-string', '6281234567890@c.us'];
    const result = guardMentions(input);
    assert.equal(result.length, 1);
    assert.equal(result[0], '6281234567890@c.us');
});

test('guardMentions returns empty array for null/undefined', () => {
    assert.deepEqual(guardMentions(null), []);
    assert.deepEqual(guardMentions(undefined), []);
});

test('guardMentions defaults maxPerMessage to 50 for tag-all support', () => {
    const input = Array.from({ length: 60 }, (_, i) => `628${i}@c.us`);
    const result = guardMentions(input);
    assert.equal(result.length, 50);
});
