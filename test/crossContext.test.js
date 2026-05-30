// Gap #1 sub-step 3-4 — person-aware memory (unified cross-context).
// Memory di-key per orang (canonical @c.us), retrieve lintas chat,
// memori asal-DM ditandai [privat] saat muncul di grup (opsi A: diskret).

const os = require('os');
const fs = require('fs');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-xctx-'));
process.env.BOT_DATA_DIR = TMP;

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

const storage = require('../modules/storage');
const chatContext = require('../chatContext');

after(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
});

// Session palsu (history >= 4) dengan senderJid + topik nyata.
const sessionFrom = (senderJid, sender, topicWords) => ({
    history: [
        { role: 'user', content: `cerita soal ${topicWords}`, sender, senderJid },
        { role: 'assistant', content: 'oke noted' },
        { role: 'user', content: `lanjut ${topicWords} dong`, sender, senderJid },
        { role: 'assistant', content: 'siap' },
    ],
    lastActivity: Date.now(),
});

test('addMessage menyimpan senderJid di entry history', () => {
    const chatId = 'jidstore@c.us';
    chatContext.addMessage(chatId, 'halo', 'hai', 'Andre', '628andre@c.us');
    const hist = chatContext.getHistory(chatId);
    const userEntry = hist.find(m => m.role === 'user');
    assert.equal(userEntry.senderJid, '628andre@c.us');
});

test('saveSessionMemory menyimpan participantJids kanonik + chatType', () => {
    storage.save('session_memories', []);
    chatContext.saveSessionMemory('628andre@c.us', sessionFrom('628andre@c.us', 'Andre', 'liburan bali pantai'));
    const mem = storage.load('session_memories', []).at(-1);
    assert.ok(mem.participantJids.includes('628andre@c.us'));
    assert.equal(mem.chatType, 'dm');
});

test('getRelevantMemory menemukan memori orang yang sama lintas chat (DM ↔ grup)', () => {
    storage.save('session_memories', []);
    // Andre cerita "motor ducati" di DM
    chatContext.saveSessionMemory('628andre@c.us', sessionFrom('628andre@c.us', 'Andre', 'motor ducati kenceng'));

    // Di GRUP, Andre (canonical sama) ngomongin "ducati" → harus keinget memori DM-nya
    const mem = chatContext.getRelevantMemory('120363@g.us', 'eh soal ducati tadi', '628andre@c.us');
    assert.ok(mem, 'harusnya nemu memori lintas chat');
    assert.match(mem, /ducati/);
});

test('memori asal-DM ditandai [privat] saat muncul di GRUP', () => {
    storage.save('session_memories', []);
    chatContext.saveSessionMemory('628andre@c.us', sessionFrom('628andre@c.us', 'Andre', 'gaji rahasia naik'));
    const mem = chatContext.getRelevantMemory('120363@g.us', 'soal gaji', '628andre@c.us');
    assert.ok(mem);
    assert.match(mem, /\[privat\]/);
});

test('memori asal-GRUP TIDAK ditandai [privat] saat muncul di DM (arah aman)', () => {
    storage.save('session_memories', []);
    // Andre ngomong di grup
    chatContext.saveSessionMemory('120363@g.us', sessionFrom('628andre@c.us', 'Andre', 'proyek kantor deadline'));
    // Di DM Andre, recall memori grup → boleh, tanpa marker privat
    const mem = chatContext.getRelevantMemory('628andre@c.us', 'soal proyek', '628andre@c.us');
    assert.ok(mem);
    assert.doesNotMatch(mem, /\[privat\]/);
});

test('backward-compat: memori lama tanpa participantJids tetap keambil by chatId', () => {
    storage.save('session_memories', [{
        chatId: '628lama@c.us',
        timestamp: Date.now(),
        participants: ['Lama'],
        topics: ['kopi', 'pagi'],
        summary: 'ngobrol soal kopi pagi',
        messageCount: 4,
    }]);
    const mem = chatContext.getRelevantMemory('628lama@c.us', 'soal kopi', '628lama@c.us');
    assert.ok(mem);
    assert.match(mem, /kopi/);
});

test('cross-PERSON tetap terisolasi: memori Budi tidak muncul buat Andre', () => {
    storage.save('session_memories', []);
    chatContext.saveSessionMemory('628budi@c.us', sessionFrom('628budi@c.us', 'Budi', 'rahasia budi xyz'));
    // Andre di grup, nyari topik yang sama → TIDAK boleh nemu memori Budi
    const mem = chatContext.getRelevantMemory('120363@g.us', 'soal xyz', '628andre@c.us');
    assert.equal(mem, null);
});
