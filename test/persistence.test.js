// Fase 1 — Persistensi "forever": memory & summary tidak auto-hapus,
// expiry di-tune jadi 24 jam. Test pakai temp data dir biar ga ngerusak data asli.

const os = require('os');
const fs = require('fs');
const path = require('path');

// WAJIB: set sebelum require storage/chatContext supaya diarahkan ke temp dir.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-persist-'));
process.env.BOT_DATA_DIR = TMP;

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../modules/storage');
const chatContext = require('../chatContext');

after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

// Session palsu dengan history >= 4 (syarat saveSessionMemory) + topik nyata.
const makeSession = (sender = 'Andre') => ({
    history: [
        { role: 'user', content: 'gimana soal blockchain crypto kemarin', sender },
        { role: 'assistant', content: 'oke jadi gini penjelasannya' },
        { role: 'user', content: 'terus soal ethereum solana gimana', sender },
        { role: 'assistant', content: 'nah itu beda lagi konsepnya' },
    ],
    lastActivity: Date.now(),
});

test('storage honors BOT_DATA_DIR override (test isolation)', () => {
    assert.equal(storage.DATA_DIR, TMP);
});

test('memory per-chat numpuk melewati cap lama (50) — tidak di-prune', () => {
    storage.save('session_memories', []);
    const chatId = 'akumulasi-perchat@c.us';

    for (let i = 0; i < 60; i++) {
        chatContext.saveSessionMemory(chatId, makeSession());
    }

    const memories = storage.load('session_memories', []);
    const forChat = memories.filter(m => m.chatId === chatId);
    assert.equal(forChat.length, 60);
});

test('memory total numpuk melewati cap lama (200) — tidak di-prune', () => {
    storage.save('session_memories', []);

    // 250 chat berbeda (1 memory each) → per-chat cap tak relevan, uji cap total.
    for (let i = 0; i < 250; i++) {
        chatContext.saveSessionMemory(`chat-${i}@c.us`, makeSession());
    }

    const memories = storage.load('session_memories', []);
    assert.equal(memories.length, 250);
});

test('chat_summaries numpuk melewati cap lama (10) — tidak di-prune', () => {
    storage.save('chat_summaries', []);

    for (let i = 0; i < 15; i++) {
        chatContext.archiveSession(`arsip-${i}@c.us`, makeSession());
    }

    const summaries = storage.load('chat_summaries', []);
    assert.equal(summaries.length, 15);
});

test('expiry window di-tune jadi 24 jam (bukan 6)', () => {
    const chatId = 'expiry-window@c.us';
    chatContext.addMessage(chatId, 'halo bubu', 'halo juga');

    // Tepat setelah pesan, elapsed ~0 → hoursUntilExpire == AUTO_EXPIRE_HOURS.
    const stats = chatContext.getStats(chatId);
    assert.equal(stats.hoursUntilExpire, 24);
});
