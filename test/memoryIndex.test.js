// Task 2 (G): memory cache + index. Verifies lookup correctness via index
// (bukan scan), backward-compat untuk memori lama, dan invalidation pada save.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-index-'));
process.env.BOT_DATA_DIR = tmpDir;

const reload = () => {
    delete require.cache[require.resolve('../chatContext')];
    delete require.cache[require.resolve('../modules/storage')];
    return require('../chatContext');
};

const makeSession = (sender = 'Andre', senderJid = '628111@c.us') => ({
    history: [
        { role: 'user', content: 'blockchain ethereum solana', sender, senderJid },
        { role: 'assistant', content: 'oke jelas' },
        { role: 'user', content: 'jelaskan smart contract', sender, senderJid },
        { role: 'assistant', content: 'gini caranya' },
    ],
    lastActivity: Date.now(),
});

test('getRelevantMemory: returns memory matching chatId via index', () => {
    const storage = require('../modules/storage');
    storage.save('session_memories', []);
    const ctx = reload();

    ctx.saveSessionMemory('chatA@c.us', makeSession('Andre', '628111@c.us'));

    const result = ctx.getRelevantMemory('chatA@c.us', 'tanya soal blockchain');
    assert.ok(result, 'must find memory for chatA');
    assert.ok(result.includes('Andre'), 'summary should mention sender');
});

test('getRelevantMemory: returns memory matching senderJid across different chat', () => {
    const storage = require('../modules/storage');
    storage.save('session_memories', []);
    const ctx = reload();

    // Same person (jid 628222@c.us) talked in DM @c.us about ethereum.
    ctx.saveSessionMemory('628222@c.us', makeSession('Rina', '628222@c.us'));

    // Now in a group, same person asks about ethereum. Should find DM memory.
    const result = ctx.getRelevantMemory('group@g.us', 'mau tanya ethereum', '628222@c.us');
    assert.ok(result, 'cross-context: same person in different chat must be found');
    assert.ok(result.includes('[privat]'), 'DM memory shown in group must be marked [privat]');
});

test('getRelevantMemory: returns null for chat with no memory and no matching jid', () => {
    const storage = require('../modules/storage');
    storage.save('session_memories', []);
    const ctx = reload();

    ctx.saveSessionMemory('chatA@c.us', makeSession('Andre', '628111@c.us'));

    const result = ctx.getRelevantMemory('chatB@c.us', 'blockchain', '628999@c.us');
    assert.equal(result, null);
});

test('cache invalidation: new memory after save is findable immediately', () => {
    const storage = require('../modules/storage');
    storage.save('session_memories', []);
    const ctx = reload();

    // First memory + retrieval populates cache.
    ctx.saveSessionMemory('chatC@c.us', makeSession('Budi', '628333@c.us'));
    const first = ctx.getRelevantMemory('chatC@c.us', 'blockchain');
    assert.ok(first, 'first save must be findable');

    // Save a second memory for a DIFFERENT chat.
    ctx.saveSessionMemory('chatD@c.us', makeSession('Citra', '628444@c.us'));

    // Second chat must be findable without restart (cache was invalidated).
    const second = ctx.getRelevantMemory('chatD@c.us', 'smart contract');
    assert.ok(second, 'second save must be findable without reload');
});

test('backward-compat: legacy memory with topics as array still matches', () => {
    const storage = require('../modules/storage');
    // Write a legacy-shape memory manually (topics is array, no participantJids).
    storage.save('session_memories', [
        {
            chatId: 'legacy@c.us',
            chatType: 'dm',
            timestamp: Date.now(),
            participants: ['LegacyUser'],
            topics: ['blockchain', 'ethereum'],
            summary: '[LegacyUser] talked about ethereum',
            messageCount: 4,
        },
    ]);
    const ctx = reload();

    const result = ctx.getRelevantMemory('legacy@c.us', 'tanya ethereum');
    assert.ok(result, 'legacy memory must still be retrievable');
    assert.ok(result.includes('LegacyUser'));
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
