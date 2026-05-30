// Fase 5 — Group Roster: fetch + cache participants.
// TDD RED: tests written BEFORE implementation. All should fail until groupRoster.js exists.

const os = require('os');
const fs = require('fs');
const path = require('path');

// WAJIB: set sebelum require storage supaya diarahkan ke temp dir.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-roster-'));
process.env.BOT_DATA_DIR = TMP;

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../modules/storage');
const {
    safeGroupStorageKey,
    normalizeParticipant,
    pickContactName,
    saveRoster,
    loadRoster,
    createGroupRosterClient,
    fetchAndCacheRoster,
} = require('../modules/groupRoster');

after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── safeGroupStorageKey ──────────────────────────────────────────

test('safeGroupStorageKey strips @g.us suffix', () => {
    const key = safeGroupStorageKey('120363424766297041@g.us');
    assert.ok(!key.includes('@g.us'));
    assert.ok(key.startsWith('group_roster_'));
});

test('safeGroupStorageKey produces consistent key for same groupId', () => {
    const a = safeGroupStorageKey('120363424766297041@g.us');
    const b = safeGroupStorageKey('120363424766297041@g.us');
    assert.equal(a, b);
});

test('safeGroupStorageKey handles groupId without suffix', () => {
    const key = safeGroupStorageKey('120363424766297041');
    assert.ok(key.startsWith('group_roster_'));
    assert.ok(key.includes('120363424766297041'));
});

test('safeGroupStorageKey replaces non-alphanumeric chars', () => {
    const key = safeGroupStorageKey('some-weird.group@g.us');
    // Key should only contain alphanumeric, underscore, hyphen
    assert.ok(/^group_roster_[a-zA-Z0-9_-]+$/.test(key));
});

// ── normalizeParticipant ─────────────────────────────────────────

test('normalizeParticipant extracts id and role from raw @c.us participant', () => {
    const raw = { id: '6281234567890@c.us', role: 'participant' };
    const result = normalizeParticipant(raw);
    assert.equal(result.id, '6281234567890@c.us');
    assert.equal(result.role, 'participant');
});

test('normalizeParticipant extracts id from @lid participant', () => {
    const raw = { id: '138384550936741@lid', role: 'admin' };
    const result = normalizeParticipant(raw);
    assert.equal(result.id, '138384550936741@lid');
    assert.equal(result.role, 'admin');
});

test('normalizeParticipant handles nested id object (_serialized)', () => {
    const raw = { id: { _serialized: '628999@c.us' }, role: 'superadmin' };
    const result = normalizeParticipant(raw);
    assert.equal(result.id, '628999@c.us');
    assert.equal(result.role, 'superadmin');
});

test('normalizeParticipant preserves name if present', () => {
    const raw = { id: '628111@c.us', role: 'participant', name: 'Andre' };
    const result = normalizeParticipant(raw);
    assert.equal(result.name, 'Andre');
});

test('normalizeParticipant defaults role to participant and name to empty', () => {
    const raw = { id: '628222@c.us' };
    const result = normalizeParticipant(raw);
    assert.equal(result.role, 'participant');
    assert.equal(result.name, '');
});

test('normalizeParticipant handles empty/null input gracefully', () => {
    const result = normalizeParticipant(null);
    assert.equal(result.id, '');
    assert.equal(result.role, 'participant');
    assert.equal(result.name, '');
});

// ── saveRoster / loadRoster roundtrip ────────────────────────────

test('saveRoster + loadRoster roundtrip via storage', () => {
    const groupId = 'roundtrip-test@g.us';
    const participants = [
        { id: '628111@c.us', role: 'admin', name: 'Alice' },
        { id: '628222@c.us', role: 'participant', name: 'Bob' },
    ];

    saveRoster(groupId, participants);
    const loaded = loadRoster(groupId);

    assert.ok(loaded);
    assert.equal(loaded.groupId, groupId);
    assert.ok(loaded.fetchedAt);
    assert.equal(loaded.participants.length, 2);
    assert.equal(loaded.participants[0].id, '628111@c.us');
    assert.equal(loaded.participants[1].name, 'Bob');
});

test('loadRoster returns null for non-existent group', () => {
    const result = loadRoster('nonexistent@g.us');
    assert.equal(result, null);
});

test('saveRoster overwrites previous roster for same group', () => {
    const groupId = 'overwrite-test@g.us';
    saveRoster(groupId, [{ id: '628111@c.us', role: 'admin', name: '' }]);
    saveRoster(groupId, [
        { id: '628111@c.us', role: 'admin', name: '' },
        { id: '628333@c.us', role: 'participant', name: '' },
    ]);

    const loaded = loadRoster(groupId);
    assert.equal(loaded.participants.length, 2);
});

// ── createGroupRosterClient ──────────────────────────────────────

test('createGroupRosterClient.fetchParticipants calls correct WAHA endpoint', async () => {
    let capturedUrl = '';
    let capturedHeaders = {};
    const mockHttpGet = async (url, opts) => {
        capturedUrl = url;
        capturedHeaders = opts?.headers || {};
        return { data: [] };
    };

    const client = createGroupRosterClient({
        wahaUrl: 'https://waha.example.com',
        session: 'TestSession',
        apiKey: 'test-key-123',
        httpGet: mockHttpGet,
    });

    await client.fetchParticipants('120363424766297041@g.us');

    assert.ok(capturedUrl.includes('/api/TestSession/groups'));
    assert.ok(capturedUrl.includes('120363424766297041@g.us'));
    assert.equal(capturedHeaders['X-Api-Key'], 'test-key-123');
});

test('createGroupRosterClient.fetchParticipants returns normalized participants', async () => {
    const mockHttpGet = async () => ({
        data: [
            { id: '628111@c.us', role: 'admin' },
            { id: '138384550936741@lid', role: 'participant' },
        ],
    });

    const client = createGroupRosterClient({
        wahaUrl: 'https://waha.example.com',
        session: 'S',
        apiKey: 'k',
        httpGet: mockHttpGet,
    });

    const result = await client.fetchParticipants('grp@g.us');
    assert.equal(result.length, 2);
    assert.equal(result[0].id, '628111@c.us');
    assert.equal(result[1].id, '138384550936741@lid');
});

test('createGroupRosterClient.fetchParticipants handles error gracefully', async () => {
    const mockHttpGet = async () => { throw new Error('network down'); };

    const client = createGroupRosterClient({
        wahaUrl: 'https://waha.example.com',
        session: 'S',
        apiKey: 'k',
        httpGet: mockHttpGet,
    });

    await assert.rejects(
        () => client.fetchParticipants('grp@g.us'),
        { message: 'network down' },
    );
});

// ── fetchAndCacheRoster ──────────────────────────────────────────

test('fetchAndCacheRoster fetches, normalizes, and saves roster', async () => {
    const mockHttpGet = async () => ({
        data: [
            { id: '628111@c.us', role: 'admin', name: 'Alice' },
            { id: '628222@c.us', role: 'participant' },
        ],
    });

    const client = createGroupRosterClient({
        wahaUrl: 'https://waha.example.com',
        session: 'S',
        apiKey: 'k',
        httpGet: mockHttpGet,
    });

    const groupId = 'fetch-cache-test@g.us';
    const roster = await fetchAndCacheRoster({ client, groupId });

    assert.equal(roster.groupId, groupId);
    assert.equal(roster.participants.length, 2);
    assert.ok(roster.fetchedAt);

    // Verify saved to storage
    const fromStorage = loadRoster(groupId);
    assert.ok(fromStorage);
    assert.equal(fromStorage.participants.length, 2);
});

test('fetchAndCacheRoster returns empty roster on fetch failure', async () => {
    const mockHttpGet = async () => { throw new Error('timeout'); };

    const client = createGroupRosterClient({
        wahaUrl: 'https://waha.example.com',
        session: 'S',
        apiKey: 'k',
        httpGet: mockHttpGet,
    });

    const groupId = 'fetch-fail-test@g.us';
    const roster = await fetchAndCacheRoster({ client, groupId });

    assert.equal(roster, null);
});

// ── pickContactName (name enrichment) ────────────────────────────

test('pickContactName prefers name over pushname/shortName', () => {
    assert.equal(pickContactName({ name: 'Ardian', pushname: 'ardian', shortName: 'Ard' }), 'Ardian');
});

test('pickContactName falls back to pushname then shortName', () => {
    assert.equal(pickContactName({ pushname: 'ardian', shortName: 'Ard' }), 'ardian');
    assert.equal(pickContactName({ shortName: 'Ard' }), 'Ard');
});

test('pickContactName returns empty string for missing/invalid data', () => {
    assert.equal(pickContactName(null), '');
    assert.equal(pickContactName({}), '');
    assert.equal(pickContactName([]), '');
});

// ── client.fetchContactName (WAHA contacts endpoint) ─────────────

test('fetchContactName calls contacts endpoint with session + contactId + api key', async () => {
    let capturedUrl = '';
    let capturedHeaders = {};
    const mockHttpGet = async (url, opts) => {
        capturedUrl = url;
        capturedHeaders = opts?.headers || {};
        return { data: { name: 'Ardian' } };
    };
    const client = createGroupRosterClient({
        wahaUrl: 'https://waha.example.com',
        session: 'BotWA',
        apiKey: 'key-xyz',
        httpGet: mockHttpGet,
    });

    const name = await client.fetchContactName('6289618750563@c.us');

    assert.equal(name, 'Ardian');
    assert.ok(capturedUrl.includes('/api/contacts'));
    assert.ok(capturedUrl.includes('session=BotWA'));
    assert.ok(capturedUrl.includes('6289618750563'));
    assert.equal(capturedHeaders['X-Api-Key'], 'key-xyz');
});

test('fetchContactName returns empty string on error (resilient)', async () => {
    const client = createGroupRosterClient({
        wahaUrl: 'https://waha.example.com',
        session: 'S',
        apiKey: 'k',
        httpGet: async () => { throw new Error('contact 404'); },
    });

    const name = await client.fetchContactName('628@c.us');
    assert.equal(name, '');
});

// ── fetchAndCacheRoster name enrichment ──────────────────────────

test('fetchAndCacheRoster enriches participants with names from contacts endpoint', async () => {
    // participants/v2 returns NO name (real WAHA behavior); contacts endpoint provides it.
    const mockHttpGet = async (url) => {
        if (url.includes('/contacts')) {
            return { data: { name: 'Ardian', pushname: 'ardian' } };
        }
        return {
            data: [
                { id: '628111@c.us', role: 'admin', name: 'Bob' }, // already named → preserved
                { id: '628222@c.us', role: 'participant' },        // no name → enriched
            ],
        };
    };
    const client = createGroupRosterClient({
        wahaUrl: 'https://waha.example.com',
        session: 'S',
        apiKey: 'k',
        httpGet: mockHttpGet,
    });

    const groupId = 'enrich-test@g.us';
    const roster = await fetchAndCacheRoster({ client, groupId });

    assert.equal(roster.participants.length, 2);
    assert.equal(roster.participants[0].name, 'Bob');     // existing name preserved
    assert.equal(roster.participants[1].name, 'Ardian');  // enriched from contacts

    // Persisted with names
    const fromStorage = loadRoster(groupId);
    assert.equal(fromStorage.participants[1].name, 'Ardian');
});
