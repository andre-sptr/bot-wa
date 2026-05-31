// Task 3 (H): TF-IDF lite scoring. Common word di banyak memori → bobot rendah;
// kata jarang yang khas → bobot tinggi.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfidf-'));
process.env.BOT_DATA_DIR = tmpDir;

const reload = () => {
    delete require.cache[require.resolve('../chatContext')];
    delete require.cache[require.resolve('../modules/storage')];
    return require('../chatContext');
};

const makeSession = (content, sender = 'User', senderJid = '628111@c.us') => ({
    history: [
        { role: 'user', content, sender, senderJid },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content, sender, senderJid },
        { role: 'assistant', content: 'ok' },
    ],
    lastActivity: Date.now(),
});

test('TF-IDF: rare word match wins over common word match', () => {
    const storage = require('../modules/storage');
    storage.save('session_memories', []);
    const ctx = reload();

    // 10 memories about generic "project" — "project" jadi common (high df).
    for (let i = 0; i < 10; i++) {
        ctx.saveSessionMemory(`chat-common-${i}@c.us`, makeSession('project meeting deadline'));
    }
    // 1 memory yg unik bahas "kubernetes" — rare (df=1).
    ctx.saveSessionMemory('chat-rare@c.us', makeSession('kubernetes deploy cluster'));

    // Query menyebut DUA kata: "project" (common) dan "kubernetes" (rare).
    // Memori "kubernetes" harus muncul (rare match), bukan salah satu yang generic.
    const result = ctx.getRelevantMemory('chat-rare@c.us', 'cek kubernetes project');
    assert.ok(result, 'must return something');
    assert.ok(result.includes('kubernetes'), 'rare-word memory should be picked');
});

test('TF-IDF: extractTopics returns object map (word -> count), not array', () => {
    const storage = require('../modules/storage');
    storage.save('session_memories', []);
    const ctx = reload();

    ctx.saveSessionMemory('chat-shape@c.us', makeSession('blockchain blockchain ethereum'));

    const memories = storage.load('session_memories', []);
    const last = memories[memories.length - 1];
    assert.ok(last.topics, 'topics must be set');
    assert.equal(typeof last.topics, 'object');
    assert.ok(!Array.isArray(last.topics), 'topics must be object map, not array');
    assert.ok(last.topics.blockchain >= 2, 'blockchain TF must reflect repeats');
});

test('backward-compat: legacy memory with topics array still scored correctly', () => {
    const storage = require('../modules/storage');
    storage.save('session_memories', [
        {
            chatId: 'legacy@c.us',
            chatType: 'dm',
            timestamp: Date.now(),
            participants: ['LegacyUser'],
            participantJids: ['628999@c.us'],
            topics: ['blockchain', 'ethereum'], // legacy array shape
            summary: '[LegacyUser] talked about ethereum',
            messageCount: 4,
        },
    ]);
    const ctx = reload();

    const result = ctx.getRelevantMemory('legacy@c.us', 'tanya soal blockchain');
    assert.ok(result, 'legacy topics array must still match');
    assert.ok(result.includes('LegacyUser'));
});

test('TF-IDF: empty query returns null', () => {
    const storage = require('../modules/storage');
    storage.save('session_memories', []);
    const ctx = reload();
    ctx.saveSessionMemory('chat-x@c.us', makeSession('something'));
    const result = ctx.getRelevantMemory('chat-x@c.us', '');
    assert.equal(result, null);
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
