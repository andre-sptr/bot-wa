# Tier-2 Memory & Polling Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tiga peningkatan skalabilitas terisolasi: (F) turunkan polling rate WAHA dari 5s → 30s, (G) tambah index untuk memory retrieval supaya tidak O(n) scan tiap pesan, (H) gantikan substring-matching dengan TF-IDF lite supaya scoring relevance lebih semantik.

**Architecture:**
- **F (polling):** satu baris config default + komentar penjelas. Env override tetap dihormati.
- **G (memory index):** module-level cache di `chatContext.js` yang menyimpan `byChat` (Map<chatId, [memoryIdx]>) dan `byJid` (Map<jid, [memoryIdx]>) berdasarkan array `memories` dari storage. Cache invalidated pada `saveSessionMemory`. Lookup jadi O(k) instead of O(n) di mana k = kandidat relevan.
- **H (TF-IDF):** ubah `extractTopics` simpan freq counts (object map word→count), bukan array top-15. `documentFrequency` (df) pre-computed bersama cache dari Task G. Scoring di `getRelevantMemory` pakai `tf × log(1 + N/df)`. Backward-compat: memory lama dengan topics array tetap dibaca (treat each word as TF=1).

**Tech Stack:** Node.js, node:test, JSON file storage. Tidak ada library baru.

**Grounding facts (terverifikasi 2026-05-31, post-Tier-1):**
- `WAHA_POLL_INTERVAL_MS` literal `'5000'` di [server.js:66](../../server.js#L66). Polling effectively at 5s.
- `extractTopics` returns array of top-15 words (no freq retained for downstream scoring) — [chatContext.js:51-64](../../chatContext.js#L51).
- `getRelevantMemory` memuat semua memory dari storage, filter, map, sort — O(n) tiap call meskipun storage layer cache 30s — [chatContext.js:115-148](../../chatContext.js#L115).
- `saveSessionMemory` di [chatContext.js:81-113](../../chatContext.js#L81) — call site untuk cache invalidation.
- Memori existing di `data/session_memories.json` punya `topics: [...]` (array) — backward-compat WAJIB supaya production data tidak break.

---

## File Structure

**Modify:**
- `server.js` (polling default, line 66)
- `chatContext.js` (extractTopics, memory cache, getRelevantMemory, saveSessionMemory invalidation)

**Create:**
- `test/memoryIndex.test.js` (cover Task 2 — index build, lookup, invalidation, backward-compat)
- `test/tfidfScoring.test.js` (cover Task 3 — common word penalty, rare word boost, backward-compat with array topics)

(Task 1 / F tidak butuh test baru — perubahan default literal yang diverifikasi via existing test + manual smoke.)

---

## Task 1: Lower polling default (F)

**Goal:** Default polling jadi 30s. Tetap configurable via env. Webhook tetap path utama, polling cuma safety net.

**Files:**
- Modify: `server.js:66`

- [ ] **Step 1: Apply change**

In `D:\Website\bot-projects\bot_wa\server.js`, find line 66:

```javascript
const WAHA_POLL_INTERVAL_MS = parseInt(process.env.WAHA_POLL_INTERVAL_MS || '5000', 10);
```

Replace with:

```javascript
// Webhook jadi path utama; polling cuma safety net kalau webhook miss/delay.
// Default 30s = ~2880 hit/hari ke WAHA /chats. Sebelumnya 5s = ~17k/hari (boros).
// Override via env WAHA_POLL_INTERVAL_MS kalau butuh refresh lebih cepat di dev.
const WAHA_POLL_INTERVAL_MS = parseInt(process.env.WAHA_POLL_INTERVAL_MS || '30000', 10);
```

- [ ] **Step 2: Verify syntax + tests**

Run from `D:/Website/bot-projects/bot_wa`:

```bash
node -c server.js
node --test 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected: parse OK, 170/170 (or current count) pass.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "perf(poll): default WAHA polling 5s -> 30s; webhook is primary path"
```

---

## Task 2: Memory cache with index (G)

**Goal:** Eliminasi O(n) filter di `getRelevantMemory`. Build & cache indexes `byChat` dan `byJid` di module-level; invalidate saat memory disimpan.

**Files:**
- Modify: `chatContext.js` (add cache + index, refactor `getRelevantMemory` to use index, invalidate in `saveSessionMemory`)
- Create: `test/memoryIndex.test.js`

- [ ] **Step 1: Tulis failing test**

Create `D:\Website\bot-projects\bot_wa\test\memoryIndex.test.js` with EXACTLY this content:

```javascript
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
```

- [ ] **Step 2: Run test untuk verifikasi FAIL**

Run: `node --test test/memoryIndex.test.js`

Expected: most tests PASS karena fungsionalitasnya sama; tapi pastikan satu run dulu untuk baseline.

(Karena Task 2 fokus refactor internal, sebagian besar test sebenarnya akan PASS bahkan tanpa refactor — tujuan utama test ini adalah jaga BACKWARD COMPAT setelah perubahan struktur. Lanjut ke Step 3 untuk apply refactor.)

- [ ] **Step 3: Apply refactor di chatContext.js**

Modify `D:\Website\bot-projects\bot_wa\chatContext.js`.

Find this block (around lines 115-148):

```javascript
const getRelevantMemory = (chatId, currentMessage, senderJid = null) => {
    const memories = storage.load('session_memories', []);
    const currentIsGroup = String(chatId).endsWith('@g.us');

    // Unified cross-context: ambil memori dari chat ini ATAU memori orang yang
    // sama (canonical senderJid) dari chat lain (DM ↔ grup).
    const chatMemories = memories.filter(m =>
        m.chatId === chatId ||
        (senderJid && Array.isArray(m.participantJids) && m.participantJids.includes(senderJid))
    );
    if (chatMemories.length === 0) return null;

    const msgWords = currentMessage.toLowerCase().match(/\b\w{3,}\b/g) || [];
    const meaningful = msgWords.filter(w => !STOP_WORDS.has(w));
    if (meaningful.length === 0) return null;

    const scored = chatMemories.map(mem => {
        const overlap = mem.topics.filter(topic =>
            meaningful.some(w => topic.includes(w) || w.includes(topic))
        ).length;
        return { ...mem, score: overlap };
    }).filter(m => m.score > 0)
      .sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);

    if (scored.length === 0) return null;

    return scored.slice(0, 2).map(m => {
        const date = new Date(m.timestamp).toLocaleDateString('id-ID');
        // Tata krama (opsi A): memori asal-DM yang muncul di GRUP ditandai [privat]
        // → Bubu diinstruksi jangan ungkit di depan orang lain (lihat buildDynamicAwarenessContext).
        const privateMark = (currentIsGroup && m.chatType === 'dm') ? '[privat] ' : '';
        return `[${date}] ${privateMark}${m.summary}`;
    }).join('\n');
};
```

Replace with:

```javascript
// ==========================================
// Memory cache + index (Task G).
// Lazy-built, invalidated on saveSessionMemory.
// ==========================================

// Helper backward-compat: legacy topics: array → treat each word as TF=1.
// New topics: object {word: count}.
const topicsAsMap = (topics) => {
    if (!topics) return {};
    if (Array.isArray(topics)) {
        const m = {};
        for (const w of topics) m[w] = 1;
        return m;
    }
    return topics;
};

let memoryCache = null;

const buildMemoryCache = (memories) => {
    const byChat = new Map();
    const byJid = new Map();
    memories.forEach((m, i) => {
        if (m.chatId) {
            if (!byChat.has(m.chatId)) byChat.set(m.chatId, []);
            byChat.get(m.chatId).push(i);
        }
        if (Array.isArray(m.participantJids)) {
            for (const jid of m.participantJids) {
                if (!byJid.has(jid)) byJid.set(jid, []);
                byJid.get(jid).push(i);
            }
        }
    });
    return { memories, byChat, byJid, size: memories.length };
};

const getMemoryCache = () => {
    const memories = storage.load('session_memories', []);
    if (!memoryCache || memoryCache.size !== memories.length) {
        memoryCache = buildMemoryCache(memories);
    }
    return memoryCache;
};

const invalidateMemoryCache = () => { memoryCache = null; };

const getRelevantMemory = (chatId, currentMessage, senderJid = null) => {
    const { memories, byChat, byJid } = getMemoryCache();
    const currentIsGroup = String(chatId).endsWith('@g.us');

    // Gabungkan kandidat lewat index (O(k), bukan O(n) scan).
    const candidateIdxs = new Set();
    if (byChat.has(chatId)) {
        for (const i of byChat.get(chatId)) candidateIdxs.add(i);
    }
    if (senderJid && byJid.has(senderJid)) {
        for (const i of byJid.get(senderJid)) candidateIdxs.add(i);
    }
    if (candidateIdxs.size === 0) return null;

    const msgWords = currentMessage.toLowerCase().match(/\b\w{3,}\b/g) || [];
    const meaningful = msgWords.filter(w => !STOP_WORDS.has(w));
    if (meaningful.length === 0) return null;

    const scored = [];
    for (const i of candidateIdxs) {
        const mem = memories[i];
        const topicMap = topicsAsMap(mem.topics);
        const topicWords = Object.keys(topicMap);
        const overlap = topicWords.filter(topic =>
            meaningful.some(w => topic.includes(w) || w.includes(topic))
        ).length;
        if (overlap > 0) scored.push({ mem, score: overlap });
    }
    if (scored.length === 0) return null;

    scored.sort((a, b) => b.score - a.score || b.mem.timestamp - a.mem.timestamp);

    return scored.slice(0, 2).map(({ mem }) => {
        const date = new Date(mem.timestamp).toLocaleDateString('id-ID');
        // Tata krama (opsi A): memori asal-DM yang muncul di GRUP ditandai [privat]
        // → Bubu diinstruksi jangan ungkit di depan orang lain (lihat buildDynamicAwarenessContext).
        const privateMark = (currentIsGroup && mem.chatType === 'dm') ? '[privat] ' : '';
        return `[${date}] ${privateMark}${mem.summary}`;
    }).join('\n');
};
```

Then find `saveSessionMemory` (around line 81). Find the line at the end of the function:

```javascript
    storage.save('session_memories', memories);
};
```

Replace with:

```javascript
    storage.save('session_memories', memories);
    invalidateMemoryCache();
};
```

Also find `archiveSession` (around line 153) at the end:

```javascript
        storage.save('chat_summaries', summaries);
    }
};
```

Replace with:

```javascript
        storage.save('chat_summaries', summaries);
    }
    invalidateMemoryCache();
};
```

(`archiveSession` already calls `saveSessionMemory`, but the chat_summaries save also happens here. Belt and suspenders.)

- [ ] **Step 4: Run test untuk verifikasi PASS**

Run: `node --test test/memoryIndex.test.js`

Expected: 5 PASS.

- [ ] **Step 5: Run full suite**

Run: `node --test 2>&1 | grep -E "^# (tests|pass|fail)"`

Expected: all PASS, no regressions. Existing `persistence.test.js` and `crossContext.test.js` use `getRelevantMemory` indirectly — verify they pass.

- [ ] **Step 6: Syntax**

Run: `node -c chatContext.js`

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add test/memoryIndex.test.js chatContext.js
git commit -m "perf(memory): index by chatId+jid for O(k) retrieval"
```

---

## Task 3: TF-IDF scoring (H)

**Goal:** Scoring relevance pakai TF×IDF, bukan substring overlap. Common words (yang muncul di banyak memori) di-bobotin rendah; kata jarang/khas di-bobotin tinggi.

**Files:**
- Modify: `chatContext.js` (extractTopics returns counts; cache adds df; getRelevantMemory scores via TF-IDF)
- Create: `test/tfidfScoring.test.js`

- [ ] **Step 1: Tulis failing test**

Create `D:\Website\bot-projects\bot_wa\test\tfidfScoring.test.js` with EXACTLY this content:

```javascript
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
```

- [ ] **Step 2: Run test untuk verifikasi FAIL**

Run: `node --test test/tfidfScoring.test.js`

Expected: test "extractTopics returns object map" FAIL (still array), and the rare-word test might PASS by accident or FAIL depending on tie-break. Continue to Step 3.

- [ ] **Step 3: Update extractTopics**

In `D:\Website\bot-projects\bot_wa\chatContext.js`, find `extractTopics` (around lines 51-64):

```javascript
const extractTopics = (messages) => {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    const words = text.match(/\b[a-zA-Z0-9]{3,}\b/g) || [];
    const freq = {};
    words.forEach(w => {
        if (!STOP_WORDS.has(w) && w.length > 2) {
            freq[w] = (freq[w] || 0) + 1;
        }
    });
    return Object.entries(freq)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([word]) => word);
};
```

Replace with:

```javascript
// Returns top-30 words as object map { word: termFrequency }. Naik dari 15 → 30
// supaya TF-IDF punya kandidat scoring lebih kaya. Memori lama dengan topics: array
// tetap di-handle via topicsAsMap di getRelevantMemory.
const extractTopics = (messages) => {
    const text = messages.map(m => m.content).join(' ').toLowerCase();
    const words = text.match(/\b[a-zA-Z0-9]{3,}\b/g) || [];
    const freq = {};
    for (const w of words) {
        if (!STOP_WORDS.has(w) && w.length > 2) {
            freq[w] = (freq[w] || 0) + 1;
        }
    }
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 30);
    const result = {};
    for (const [w, c] of top) result[w] = c;
    return result;
};
```

- [ ] **Step 4: Update buildMemoryCache untuk include df**

In `chatContext.js`, find `buildMemoryCache` (from Task 2):

```javascript
const buildMemoryCache = (memories) => {
    const byChat = new Map();
    const byJid = new Map();
    memories.forEach((m, i) => {
        if (m.chatId) {
            if (!byChat.has(m.chatId)) byChat.set(m.chatId, []);
            byChat.get(m.chatId).push(i);
        }
        if (Array.isArray(m.participantJids)) {
            for (const jid of m.participantJids) {
                if (!byJid.has(jid)) byJid.set(jid, []);
                byJid.get(jid).push(i);
            }
        }
    });
    return { memories, byChat, byJid, size: memories.length };
};
```

Replace with:

```javascript
const buildMemoryCache = (memories) => {
    const byChat = new Map();
    const byJid = new Map();
    const df = {}; // document frequency: word → jumlah memori yang punya kata itu
    memories.forEach((m, i) => {
        if (m.chatId) {
            if (!byChat.has(m.chatId)) byChat.set(m.chatId, []);
            byChat.get(m.chatId).push(i);
        }
        if (Array.isArray(m.participantJids)) {
            for (const jid of m.participantJids) {
                if (!byJid.has(jid)) byJid.set(jid, []);
                byJid.get(jid).push(i);
            }
        }
        const topicMap = topicsAsMap(m.topics);
        for (const word of Object.keys(topicMap)) {
            df[word] = (df[word] || 0) + 1;
        }
    });
    return { memories, byChat, byJid, df, N: memories.length, size: memories.length };
};
```

- [ ] **Step 5: Update getRelevantMemory scoring**

In `chatContext.js`, find the scoring section inside `getRelevantMemory`:

```javascript
    const scored = [];
    for (const i of candidateIdxs) {
        const mem = memories[i];
        const topicMap = topicsAsMap(mem.topics);
        const topicWords = Object.keys(topicMap);
        const overlap = topicWords.filter(topic =>
            meaningful.some(w => topic.includes(w) || w.includes(topic))
        ).length;
        if (overlap > 0) scored.push({ mem, score: overlap });
    }
```

Replace with:

```javascript
    // TF-IDF lite: score = Σ (tf × idf) untuk setiap kata query yang match topik memori.
    // idf = log(1 + N/df). Substring match dapat 0.3× credit (preserve fuzzy behavior lama).
    const cache = getMemoryCache();
    const N = Math.max(1, cache.N);
    const df = cache.df;
    const scored = [];
    for (const i of candidateIdxs) {
        const mem = memories[i];
        const topicMap = topicsAsMap(mem.topics);
        let score = 0;
        for (const qw of meaningful) {
            if (topicMap[qw]) {
                // Exact match: full credit.
                const idf = Math.log(1 + N / (df[qw] || 1));
                score += topicMap[qw] * idf;
            } else {
                // Substring fallback: ambil match pertama, credit 0.3×.
                for (const tw of Object.keys(topicMap)) {
                    if (tw.includes(qw) || qw.includes(tw)) {
                        const idf = Math.log(1 + N / (df[tw] || 1));
                        score += topicMap[tw] * idf * 0.3;
                        break;
                    }
                }
            }
        }
        if (score > 0) scored.push({ mem, score });
    }
```

- [ ] **Step 6: Run tests**

Run from `D:/Website/bot-projects/bot_wa`:

```bash
node --test test/tfidfScoring.test.js
node --test test/memoryIndex.test.js
node --test 2>&1 | grep -E "^# (tests|pass|fail)"
node -c chatContext.js
```

Expected:
- `tfidfScoring.test.js`: 4 PASS.
- `memoryIndex.test.js`: 5 PASS (still — no behavior change for those tests).
- Full suite: all PASS.

- [ ] **Step 7: Commit**

```bash
git add test/tfidfScoring.test.js chatContext.js
git commit -m "perf(memory): TF-IDF lite scoring for semantic relevance"
```

---

## Self-Review

**Spec coverage:**
- F → Task 1 (one-line config + comment).
- G → Task 2 (cache + index + invalidation + backward-compat).
- H → Task 3 (object-map topics + df + TF-IDF scoring + substring fallback).

**Placeholder scan:** Tidak ada TBD / "implement later" / generic "handle edge cases".

**Type consistency:**
- `topicsAsMap(topics)` defined di Task 2, dipakai di Task 2 (`getRelevantMemory`) dan Task 3 (`buildMemoryCache`, scoring). Konsisten.
- `memoryCache` shape: Task 2 adds `byChat, byJid, size`; Task 3 adds `df, N`. Same object, additive.
- `invalidateMemoryCache()` digunakan di `saveSessionMemory` dan `archiveSession`. Konsisten.

**Test isolation:** Semua test baru pakai `tmpdir` + `BOT_DATA_DIR` override + `delete require.cache` mengikuti pattern Tier-1.

**Backward-compat:**
- Memori lama (`topics: []`) → `topicsAsMap` convert ke `{word: 1}`. TF jadi 1 untuk semua kata, IDF tetap jalan. Tidak crash, scoring degrades gracefully.
- File `data/session_memories.json` existing tidak perlu migrasi. Cuma membership baru yang pakai format object.

**Ordering rationale:**
- Task 1 (F) paling kecil, independen — di depan untuk warm up.
- Task 2 (G) bikin index & cache infrastructure.
- Task 3 (H) layering TF-IDF di atas cache dari Task 2. Tidak bisa dibalik.

**Out-of-scope:**
- Tier-2 E (server.js refactor) — sengaja dipisah ke plan lain karena scope besar dan risk berbeda profile.
- Embedding-based retrieval — heavy dependency (anthropic embeddings / voyage). Tidak dibutuhkan di skala personal-bot.
