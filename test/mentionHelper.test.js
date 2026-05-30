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

test('extractMentionIntents skips @all and @everyone', () => {
    const intents = extractMentionIntents('Hey @all dan @everyone cek', ROSTER);
    assert.equal(intents.length, 0);
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

// ── guardMentions ────────────────────────────────────────────────

test('guardMentions caps mentions to maxPerMessage', () => {
    const input = ['a@c.us', 'b@c.us', 'c@c.us', 'd@c.us', 'e@c.us', 'f@c.us'];
    const result = guardMentions(input, 3);
    assert.equal(result.length, 3);
});

test('guardMentions strips "all" from mentions', () => {
    const input = ['all', '6281234567890@c.us'];
    const result = guardMentions(input);
    assert.ok(!result.includes('all'));
    assert.equal(result.length, 1);
});

test('guardMentions returns empty array for null/undefined', () => {
    assert.deepEqual(guardMentions(null), []);
    assert.deepEqual(guardMentions(undefined), []);
});

test('guardMentions defaults maxPerMessage to 5', () => {
    const input = Array.from({ length: 10 }, (_, i) => `628${i}@c.us`);
    const result = guardMentions(input);
    assert.equal(result.length, 5);
});
