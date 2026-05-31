# Tier-2 E — server.js Monolith Refactor (Moderate)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pecah `server.js` (1146 baris) jadi tiga modul fokus untuk turunkan maintenance load tanpa mengubah behavior. Target akhir: server.js ≈680 baris (orchestrator + wire-up + routes), tiga modul terisolasi yang bisa di-reason secara independen.

**Architecture:**
- **Task 1 — `modules/crypto.js`:** Pure functions (`getCrypto`, `getMultipleCrypto`, `getKurs`, `COIN_ALIAS`). Tidak ada state. Hanya import axios. ~50 baris pindah.
- **Task 2 — `modules/commands.js`:** Factory pattern `createCommandHandler({ sendWA, groupRosterClient })` mengembalikan `processCommand(msg, chatId, askAI)`. Pindahkan `processCommand` + helper lokal `parseWaktu`. ~150 baris pindah.
- **Task 3 — `modules/webhookProcessor.js`:** Factory pattern `createWebhookProcessor({ ...deps })` mengembalikan `processIncomingPayload({ body, payload, record, source, force })`. Inject sendWA, makeAskAI, processCommand, handleNaturalLanguage, summarizePayload, dedup helpers, botTriggerState, groupRosterClient, lidResolver, mentionCooldownStore. ~285 baris pindah.

**Strategi safety:**
- Existing 179 tests adalah regression guard utama — semua harus tetap PASS setelah masing-masing extraction.
- Tambah smoke test per modul baru (lock API surface), bukan replay seluruh behavior.
- Setiap task self-contained dengan satu commit — kalau ada gagal, mudah revert per task.

**Tech Stack:** Node.js, node:test (built-in). Tidak ada library baru.

**Grounding facts (terverifikasi 2026-05-31, post-Tier-1+2):**
- `server.js` 1146 baris setelah Tier-1 + Tier-2 F+G+H.
- Functions yang akan dipindah:
  - `getCrypto` @ [server.js:109](../../server.js#L109)
  - `getMultipleCrypto` @ [server.js:123](../../server.js#L123)
  - `getKurs` @ [server.js:144](../../server.js#L144)
  - `COIN_ALIAS` @ [server.js:103](../../server.js#L103)
  - `parseWaktu` @ [server.js:419](../../server.js#L419)
  - `processCommand` @ [server.js:428-555](../../server.js#L428)
  - `processIncomingPayload` @ [server.js:606-890](../../server.js#L606)
- `summarizePayload` (line 334) dipakai oleh `processIncomingPayload`, `analyzeWahaMessage`, debug routes — TETAP di server.js, di-inject ke `webhookProcessor`.

---

## File Structure

**Modify:**
- `server.js` (extract imports, inject factories)

**Create:**
- `modules/crypto.js`
- `modules/commands.js`
- `modules/webhookProcessor.js`
- `test/crypto.test.js` (smoke + axios mock)
- `test/commands.test.js` (smoke + parseWaktu pure test + dispatch routing)
- `test/webhookProcessor.test.js` (smoke + minimal payload smoke)

---

## Task 1: Extract modules/crypto.js

**Goal:** Pindahkan COIN_ALIAS dan 3 fungsi crypto/kurs ke modul terpisah. Pure functions, no state.

**Files:**
- Create: `modules/crypto.js`
- Create: `test/crypto.test.js`
- Modify: `server.js` (remove + import)

- [ ] **Step 1: Tulis smoke test**

Create `D:\Website\bot-projects\bot_wa\test\crypto.test.js` with EXACTLY:

```javascript
// Smoke test: lock API surface of modules/crypto.js after extraction from server.js.

const test = require('node:test');
const assert = require('node:assert/strict');

test('crypto module exports getCrypto, getMultipleCrypto, getKurs, COIN_ALIAS', () => {
    const crypto = require('../modules/crypto');
    assert.equal(typeof crypto.getCrypto, 'function');
    assert.equal(typeof crypto.getMultipleCrypto, 'function');
    assert.equal(typeof crypto.getKurs, 'function');
    assert.equal(typeof crypto.COIN_ALIAS, 'object');
    assert.equal(crypto.COIN_ALIAS.btc, 'bitcoin');
    assert.equal(crypto.COIN_ALIAS.eth, 'ethereum');
});

test('getCrypto returns N/A on network failure (resilience)', async () => {
    const crypto = require('../modules/crypto');
    // Use an invalid coin id to trigger API miss without mocking axios.
    // CoinGecko returns 200 with empty object for unknown ids → price falsy → returns 'N/A'.
    const result = await crypto.getCrypto('this-coin-does-not-exist-12345');
    assert.equal(result, 'N/A');
});
```

- [ ] **Step 2: Run test untuk verifikasi FAIL**

Run: `node --test test/crypto.test.js`

Expected: FAIL — module belum ada.

- [ ] **Step 3: Create modules/crypto.js**

Copy the EXACT content of lines 103-155 from `server.js` (the `COIN_ALIAS`, `getCrypto`, `getMultipleCrypto`, `getKurs` definitions) into a new file `D:\Website\bot-projects\bot_wa\modules\crypto.js`. Prepend `const axios = require('axios');` and append `module.exports = { COIN_ALIAS, getCrypto, getMultipleCrypto, getKurs };`.

Result should look like:

```javascript
// Crypto + Kurs helpers. Pure functions, no shared state.

const axios = require('axios');

const COIN_ALIAS = {
    btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
    xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', matic: 'matic-network',
    dot: 'polkadot', avax: 'avalanche-2', emas: 'tether-gold', gold: 'tether-gold'
};

const getCrypto = async (coinInput) => {
    try {
        const coinId = COIN_ALIAS[coinInput.toLowerCase()] || coinInput.toLowerCase();
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=idr`,
            { timeout: 8000 }
        );
        let price = res.data?.[coinId]?.idr;
        if (!price) return 'N/A';
        if (coinId === 'tether-gold') price = price / 31.1035;
        return Math.round(price).toLocaleString('id-ID');
    } catch { return 'N/A'; }
};

const getMultipleCrypto = async (coinsArray) => {
    try {
        const ids = coinsArray.join(',');
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=idr`,
            { timeout: 8000 }
        );
        const prices = {};
        coinsArray.forEach(coin => {
            let price = res.data?.[coin]?.idr;
            if (!price) { prices[coin] = 'N/A'; return; }
            if (coin === 'tether-gold') price = price / 31.1035;
            prices[coin] = Math.round(price).toLocaleString('id-ID');
        });
        return prices;
    } catch (e) {
        console.error('Gagal load multiple crypto:', e.message);
        return {};
    }
};

const getKurs = async (currency = 'USD') => {
    try {
        const code = currency.toUpperCase();
        const res = await axios.get(`https://api.exchangerate-api.com/v4/latest/IDR`, { timeout: 8000 });
        const rate = res.data?.rates?.[code];
        if (!rate) return null;
        return Math.round(1 / rate).toLocaleString('id-ID');
    } catch { return null; }
};

module.exports = { COIN_ALIAS, getCrypto, getMultipleCrypto, getKurs };
```

- [ ] **Step 4: Update server.js — remove inline definitions and import from new module**

In `server.js`, find the `// 3. CRYPTO & KURS` block from lines ~101-155 (the header comment plus all 4 definitions). REMOVE that entire block.

Then, in the require block near the top (after the other module requires, e.g. after `const { createCooldownStore } = require('./modules/cooldownStore');`), add:

```javascript
const { getCrypto, getMultipleCrypto, getKurs } = require('./modules/crypto');
```

(Don't import `COIN_ALIAS` — it's not used outside the crypto functions in server.js.)

- [ ] **Step 5: Verify**

Run from `D:/Website/bot-projects/bot_wa`:

```bash
node -c server.js modules/crypto.js
node --test 2>&1 | grep -E "^# (tests|pass|fail)"
```

Expected:
- syntax clean
- 181/181 PASS (179 prior + 2 new crypto smoke tests)

- [ ] **Step 6: Commit**

```bash
git add modules/crypto.js test/crypto.test.js server.js
git commit -m "refactor(server): extract crypto/kurs helpers to modules/crypto.js"
```

---

## Task 2: Extract modules/commands.js

**Goal:** Pindahkan `processCommand` (139 baris dispatch dengan 13+ branches) dan `parseWaktu` helper ke modul terpisah. Factory pattern karena butuh injection `sendWA` dan `groupRosterClient`.

**Files:**
- Create: `modules/commands.js`
- Create: `test/commands.test.js`
- Modify: `server.js`

- [ ] **Step 1: Tulis smoke test**

Create `D:\Website\bot-projects\bot_wa\test\commands.test.js` with EXACTLY:

```javascript
// Lock API surface of modules/commands.js dan test parseWaktu (pure).

const test = require('node:test');
const assert = require('node:assert/strict');

test('commands module exports createCommandHandler and parseWaktu', () => {
    const m = require('../modules/commands');
    assert.equal(typeof m.createCommandHandler, 'function');
    assert.equal(typeof m.parseWaktu, 'function');
});

test('parseWaktu: parses minutes', () => {
    const { parseWaktu } = require('../modules/commands');
    assert.equal(parseWaktu('5m'), 5 * 60 * 1000);
});

test('parseWaktu: parses hours', () => {
    const { parseWaktu } = require('../modules/commands');
    assert.equal(parseWaktu('1h'), 60 * 60 * 1000);
});

test('parseWaktu: parses hours+minutes', () => {
    const { parseWaktu } = require('../modules/commands');
    assert.equal(parseWaktu('2h30m'), (2 * 60 + 30) * 60 * 1000);
});

test('parseWaktu: returns null for invalid input', () => {
    const { parseWaktu } = require('../modules/commands');
    assert.equal(parseWaktu('garbage'), null);
});

test('createCommandHandler returns async function', () => {
    const { createCommandHandler } = require('../modules/commands');
    const handle = createCommandHandler({
        sendWA: async () => ({ ok: true }),
        groupRosterClient: null,
    });
    assert.equal(typeof handle, 'function');
});

test('command dispatch: non-command returns null', async () => {
    const { createCommandHandler } = require('../modules/commands');
    const handle = createCommandHandler({
        sendWA: async () => ({ ok: true }),
        groupRosterClient: null,
    });
    const result = await handle('halo bukan command', 'chat@c.us', async () => 'reply');
    assert.equal(result, null);
});

test('command dispatch: /help returns help string', async () => {
    const { createCommandHandler } = require('../modules/commands');
    const handle = createCommandHandler({
        sendWA: async () => ({ ok: true }),
        groupRosterClient: null,
    });
    const result = await handle('/help', 'chat@c.us', async () => 'reply');
    assert.ok(typeof result === 'string' && result.includes('Command'));
});

test('command dispatch: /reset returns reset confirmation', async () => {
    const { createCommandHandler } = require('../modules/commands');
    const handle = createCommandHandler({
        sendWA: async () => ({ ok: true }),
        groupRosterClient: null,
    });
    const result = await handle('/reset', 'chat-reset-test@c.us', async () => 'reply');
    assert.ok(typeof result === 'string' && result.toLowerCase().includes('reset'));
});
```

- [ ] **Step 2: Run test untuk verifikasi FAIL**

Run: `node --test test/commands.test.js`

Expected: FAIL — module belum ada.

- [ ] **Step 3: Create modules/commands.js**

Create `D:\Website\bot-projects\bot_wa\modules\commands.js` with EXACTLY:

```javascript
// Command dispatcher factory.
// Extracted from server.js processCommand (Tier-2 E).
// Returns an async (msg, chatId, askAI) => string|null handler.

const { getHistory, clearHistory, getStats } = require('../chatContext');
const { summarizeConversation } = require('./aiAdvanced');
const { getActivePersonaName } = require('./aiFeatures');
const { manageRecurringReminder, manageServerMonitor } = require('./automation');
const { fetchAndCacheRoster } = require('./groupRoster');
const { saveProactiveState } = require('./proactiveGuard');
const { getCrypto, getMultipleCrypto, getKurs } = require('./crypto');

// Pure helper kept here because only processCommand uses it.
const parseWaktu = (str) => {
    const match = str.match(/(?:(\d+)h)?(?:(\d+)m)?/i);
    if (!match || (!match[1] && !match[2])) return null;
    return ((parseInt(match[1] || 0) * 60) + parseInt(match[2] || 0)) * 60 * 1000;
};

const createCommandHandler = ({ sendWA, groupRosterClient }) => {
    return async (msg, chatId, askAI) => {
        if (!msg?.startsWith('/')) return null;

        const [cmd, ...args] = msg.trim().split(' ');
        const param = args.join(' ');
        const command = cmd.toLowerCase();

        switch (command) {
            case '/harga': {
                if (!param) return 'Format: `/harga [koin]`\nContoh: `/harga bitcoin` atau `/harga btc`\n\nKoin populer: btc, eth, sol, bnb, xrp, doge, emas';
                const price = await getCrypto(param);
                return price !== 'N/A'
                    ? `*${param.toUpperCase()}*: Rp ${price}`
                    : `Koin "${param}" tidak ditemukan. Coba nama lengkap seperti "bitcoin".`;
            }

            case '/tanya': {
                if (!param) return 'Format: `/tanya [pertanyaan]`\nContoh: `/tanya apa itu blockchain?`';
                const ans = await askAI('Bantu jawab pertanyaan ini dengan singkat, jelas, dan gaya khas Bubu.', param);
                return ans || 'Bubu lagi gabisa jawab nih, coba lagi ya!';
            }

            case '/brief': {
                const coins = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'tether-gold'];
                const prices = await getMultipleCrypto(coins);
                return `*Morning Brief*\n\n*Crypto & Emas (IDR):*\n` +
                    `- BTC: Rp ${prices['bitcoin'] || 'N/A'}\n` +
                    `- ETH: Rp ${prices['ethereum'] || 'N/A'}\n` +
                    `- SOL: Rp ${prices['solana'] || 'N/A'}\n` +
                    `- BNB: Rp ${prices['binancecoin'] || 'N/A'}\n` +
                    `- Emas: Rp ${prices['tether-gold'] || 'N/A'}/troy oz`;
            }

            case '/kurs': {
                const currency = param?.toUpperCase() || 'USD';
                const rate = await getKurs(currency);
                if (!rate) return `Mata uang "${currency}" tidak ditemukan.\nContoh: /kurs USD, /kurs SGD, /kurs JPY`;
                return `*Kurs ${currency}*\n\n1 ${currency} = *Rp ${rate}*\n\n_Sumber: exchangerate-api.com_`;
            }

            case '/reminder': {
                if (!param || args.length < 2) return 'Format: `/reminder [waktu] [pesan]`\nContoh: `/reminder 30m Minum obat`\nWaktu: `5m`, `1h`, `2h30m`';
                const ms = parseWaktu(args[0]);
                if (!ms) return 'Format waktu tidak valid. Gunakan: `5m`, `1h`, `2h30m`';
                const pesanReminder = args.slice(1).join(' ');
                setTimeout(() => sendWA(`*REMINDER!*\n\n${pesanReminder}`, chatId), ms);
                const menit = Math.round(ms / 60000);
                const readableTime = menit >= 60
                    ? `${Math.floor(menit / 60)} jam ${menit % 60 > 0 ? (menit % 60) + ' menit' : ''}`.trim()
                    : `${menit} menit`;
                return `*Reminder diset!*\n\n"${pesanReminder}"\nDalam ${readableTime}`;
            }

            case '/harian': {
                return manageRecurringReminder(args[0]?.toLowerCase(), args.slice(1).join(' '), sendWA);
            }

            case '/server': {
                return await manageServerMonitor(args[0]?.toLowerCase(), args.slice(1).join(' '), sendWA);
            }

            case '/rangkum': {
                const history = getHistory(chatId);
                if (history.length === 0) return 'Belum ada riwayat percakapan untuk dirangkum.';
                const summary = await summarizeConversation(history, askAI);
                return summary ? `*Rangkuman Percakapan:*\n\n${summary}` : 'Gagal merangkum percakapan.';
            }

            case '/stats': {
                const stats = getStats(chatId);
                return `*Statistik Chat*\n\n` +
                    `Pesan tersimpan: ${stats.messageCount}\n` +
                    `Ingatan tersimpan: ${stats.memoryCount} session\n` +
                    `Aktivitas terakhir: ${stats.lastActivity}\n` +
                    `Auto-expire dalam: ${stats.hoursUntilExpire}h\n` +
                    `Kapasitas max: ${stats.maxHistory} pesan`;
            }

            case '/reset': {
                clearHistory(chatId);
                return `Riwayat chat Bubu sudah di-reset! Bubu siap ngobrol topik baru`;
            }

            case '/refresh-members': {
                if (!chatId.endsWith('@g.us')) return 'Command ini cuma bisa dipakai di grup.';
                if (!groupRosterClient) return 'WAHA belum dikonfigurasi.';
                const roster = await fetchAndCacheRoster({ client: groupRosterClient, groupId: chatId });
                if (!roster) return 'Gagal mengambil daftar anggota grup. Coba lagi nanti.';
                const adminCount = roster.participants.filter(p => p.role === 'admin' || p.role === 'superadmin').length;
                return `✅ Roster diupdate: ${roster.participants.length} anggota (${adminCount} admin).`;
            }

            case '/aktif': {
                if (!chatId.endsWith('@g.us')) return 'Command ini cuma bisa dipakai di grup.';
                saveProactiveState(chatId, true);
                return '🔊 Bubu aktif mode! Bubu boleh nimbrung kalau ada topik menarik.';
            }

            case '/diem': {
                if (!chatId.endsWith('@g.us')) return 'Command ini cuma bisa dipakai di grup.';
                saveProactiveState(chatId, false);
                return '🔇 Bubu diem mode. Bubu cuma jawab kalau dipanggil.';
            }

            case '/help':
                return `*Daftar Command ${getActivePersonaName()}*\n\n` +
                    `*/harga [koin]* — Harga crypto\n` +
                    `*/kurs [mata_uang]* — Kurs ke IDR\n` +
                    `*/tanya [pertanyaan]* — Tanya Bubu\n` +
                    `*/brief* — Morning brief\n` +
                    `*/reminder [waktu] [pesan]*\n` +
                    `*/harian [jam] [pesan]*\n` +
                    `*/harian [hari] [jam] [pesan]*\n` +
                    `*/server* — Monitor server\n` +
                    `*/rangkum* — Rangkum percakapan\n` +
                    `*/stats* — Statistik chat\n` +
                    `*/reset* — Reset riwayat chat\n` +
                    `*/refresh-members* — Update roster anggota grup\n` +
                    `*/aktif* — Bubu boleh nimbrung di grup\n` +
                    `*/diem* — Bubu cuma jawab kalau dipanggil\n\n` +
                    `_Panggil "Bubu", reply pesan Bubu, atau tag @Bubu untuk ngobrol!_`;

            default:
                return null;
        }
    };
};

module.exports = { createCommandHandler, parseWaktu };
```

- [ ] **Step 4: Update server.js**

In `server.js`:

a. Remove the entire `// 6. PROCESS COMMAND` section. That is `parseWaktu` (~line 419-426) AND `processCommand` (~lines 428-555). Keep the `// 6.` and `// 7.` section headers — they organize the file. Or remove the `// 6.` header too since the code under it moves; use your judgment to keep header lines tidy.

b. Add import in the require block near the top:

```javascript
const { createCommandHandler } = require('./modules/commands');
```

c. Construct the handler near where the other factories are wired (near `botTriggerState`, `groupRosterClient`, `lidResolver` declarations around line ~245):

```javascript
const processCommand = createCommandHandler({ sendWA, groupRosterClient });
```

NOTE: `processCommand` is referenced in `processIncomingPayload` and `handleNaturalLanguage`. These call sites stay the same — they just call `processCommand(msg, chatId, askAI)` against the new factory-built handler.

PLACEMENT MATTERS: `sendWA` must be defined BEFORE `createCommandHandler(...)` is called. Verify the order in your edits.

- [ ] **Step 5: Run tests**

Run from `D:/Website/bot-projects/bot_wa`:

```bash
node --test test/commands.test.js
node --test 2>&1 | grep -E "^# (tests|pass|fail)"
node -c server.js
```

Expected:
- `commands.test.js`: 9 PASS.
- Full suite: 190/190 (181 + 9 new) PASS.
- syntax clean.

- [ ] **Step 6: Commit**

```bash
git add modules/commands.js test/commands.test.js server.js
git commit -m "refactor(server): extract processCommand to modules/commands.js factory"
```

---

## Task 3: Extract modules/webhookProcessor.js

**Goal:** Pindahkan `processIncomingPayload` (285 baris, otak pemrosesan pesan masuk) ke modul terpisah. Factory dengan injection deps yang banyak — necessary evil karena orchestrator function.

**Files:**
- Create: `modules/webhookProcessor.js`
- Create: `test/webhookProcessor.test.js`
- Modify: `server.js`

- [ ] **Step 1: Tulis smoke test**

Create `D:\Website\bot-projects\bot_wa\test\webhookProcessor.test.js` with EXACTLY:

```javascript
// Smoke test: lock API surface of modules/webhookProcessor.js.
// Behavior-level regression is guarded by the existing full test suite (179+ tests).

const test = require('node:test');
const assert = require('node:assert/strict');

test('webhookProcessor exports createWebhookProcessor', () => {
    const m = require('../modules/webhookProcessor');
    assert.equal(typeof m.createWebhookProcessor, 'function');
});

test('createWebhookProcessor returns a function', () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const fn = createWebhookProcessor({
        sendWA: async () => ({ ok: true }),
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => null,
        summarizePayload: () => ({}),
        resolveCanonicalSender: async (jid) => jid,
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: { botIdentifiers: new Set(), recentBotMessageIds: new Set() },
        groupRosterClient: null,
        lidResolver: null,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        GROUP_ID: 'test@g.us',
        MENTION_COOLDOWN_MS: 5000,
    });
    assert.equal(typeof fn, 'function');
});

test('processIncomingPayload: drops non-DM non-group chat with record', async () => {
    const { createWebhookProcessor } = require('../modules/webhookProcessor');
    const records = [];
    const record = (stage, details) => records.push({ stage, details });

    const processIncoming = createWebhookProcessor({
        sendWA: async () => ({ ok: true }),
        makeAskAI: () => async () => 'reply',
        processCommand: async () => null,
        handleNaturalLanguage: async () => null,
        summarizePayload: () => ({}),
        resolveCanonicalSender: async (jid) => jid,
        hasProcessedIncoming: () => false,
        markProcessedIncoming: () => {},
        isRateLimited: () => false,
        summarizeBotState: () => ({}),
        botTriggerState: { botIdentifiers: new Set(), recentBotMessageIds: new Set() },
        groupRosterClient: null,
        lidResolver: null,
        mentionCooldownStore: { get: () => 0, set: () => {} },
        GROUP_ID: 'expected-target@g.us',
        MENTION_COOLDOWN_MS: 5000,
    });

    // Broadcast channel — not DM, not target group → must be filtered.
    await processIncoming({
        body: { event: 'message' },
        payload: { from: 'someone@broadcast', body: 'hi' },
        record,
        source: 'test',
    });

    assert.ok(records.some(r => r.stage === 'test-chat-filtered'),
        'expected chat-filtered record for broadcast');
});
```

- [ ] **Step 2: Run test untuk verifikasi FAIL**

Run: `node --test test/webhookProcessor.test.js`

Expected: FAIL — module belum ada.

- [ ] **Step 3: Create modules/webhookProcessor.js**

This is the largest file in this plan. The body of `processIncomingPayload` from server.js (~lines 606-890) moves inside the factory closure, with dependency identifiers coming from the factory parameters instead of module-level globals.

Create `D:\Website\bot-projects\bot_wa\modules\webhookProcessor.js` with EXACTLY:

```javascript
// Webhook + poll incoming message processor.
// Extracted from server.js processIncomingPayload (Tier-2 E).
// Factory pattern — caller injects all server-local dependencies.

const { getPayloadChatId, getPayloadSenderId, isOutgoingMessage, rememberBotMessage,
        detectMessageTrigger, learnBotMentionFromIncoming, messageIdCandidates } = require('./messageTriggers');
const { buildRuntimeChatContext, autoCategorize } = require('./aiAdvanced');
const { loadRoster, fetchAndCacheRoster } = require('./groupRoster');
const { shouldConsiderProactive, checkProactiveCooldown, markProactiveSent,
        PROACTIVE_SKIP_MARKER } = require('./proactiveGuard');
const { withChatLock } = require('../chatContext');
const { extractDMs, stripDMTags } = require('./reasoning');
const { extractMentionIntents, formatMentionedReply } = require('./mentionHelper');
const { previewText, safeError } = require('./webhookDebug');

const createWebhookProcessor = ({
    sendWA, makeAskAI, processCommand, handleNaturalLanguage, summarizePayload,
    resolveCanonicalSender, hasProcessedIncoming, markProcessedIncoming,
    isRateLimited, summarizeBotState,
    botTriggerState, groupRosterClient, lidResolver, mentionCooldownStore,
    GROUP_ID, MENTION_COOLDOWN_MS,
}) => {
    return async ({ body, payload, record, source = 'webhook', force = false }) => {
        const _data = payload._data || {};
        const chatId = getPayloadChatId(payload);
        const isGroup = chatId.endsWith('@g.us');
        const isTargetGroup = Boolean(GROUP_ID && chatId === GROUP_ID);
        const isDM = !isGroup
            && !chatId.endsWith('@broadcast')
            && !chatId.endsWith('@newsletter')
            && chatId.length > 0;
        if (!isDM && !isTargetGroup) {
            record(`${source}-chat-filtered`, {
                reason: 'chat is neither target group nor DM',
                expectedGroupId: GROUP_ID,
                actualChatId: chatId,
                payload: summarizePayload(body, payload, chatId),
            });
            return;
        }

        if (isOutgoingMessage(payload)) {
            const tracked = rememberBotMessage(botTriggerState, {
                id: _data.id || payload.id,
                participant: payload.participant || payload.author,
                author: payload.author,
                _data,
                me: body.me,
            });
            markProcessedIncoming(payload);
            record(`${source}-outgoing-ignored`, {
                payload: summarizePayload(body, payload, chatId),
                tracked,
                state: summarizeBotState(),
            });
            return;
        }

        const msgBody = (payload.body || _data.body || '').trim();
        if (!msgBody) {
            record(`${source}-empty-body`, {
                payload: summarizePayload(body, payload, chatId),
            });
            return;
        }

        if (!force && hasProcessedIncoming(payload)) {
            record(`${source}-duplicate`, {
                payload: summarizePayload(body, payload, chatId),
            });
            return;
        }
        // Atomic mark BEFORE any await so concurrent webhook+poll cannot both pass.
        if (!force) markProcessedIncoming(payload);

        const senderJid = isGroup ? getPayloadSenderId(payload, chatId) : chatId;
        const senderName = _data.notifyName || payload.notifyName || senderJid.split('@')[0];
        const chatContext = buildRuntimeChatContext({ chatId, senderJid, payload });

        let roster = null;
        if (isGroup) {
            roster = loadRoster(chatId);
            if (!roster && groupRosterClient) {
                try {
                    roster = await fetchAndCacheRoster({ client: groupRosterClient, groupId: chatId });
                    if (roster) {
                        console.log(`[Roster] Auto-fetched roster for ${chatId}: ${roster.participants.length} members`);
                    }
                } catch (e) {
                    console.error(`[Roster] Auto-fetch failed for ${chatId}:`, e?.message);
                }
            }
            if (roster && roster.participants) {
                const names = roster.participants
                    .filter(p => p.name)
                    .map(p => `${p.name} (${p.id})`)
                    .slice(0, 20);
                chatContext.rosterSummary = names.length > 0
                    ? `${roster.participants.length} anggota (${names.join(', ')})`
                    : `${roster.participants.length} anggota`;
            }
        }

        const learnedFromIncoming = learnBotMentionFromIncoming(botTriggerState, payload);
        if (learnedFromIncoming.length > 0) {
            record(`${source}-incoming-bot-lid-learned`, {
                learnedBotIdentifiers: learnedFromIncoming,
                payload: summarizePayload(body, payload, chatId, senderJid),
                state: summarizeBotState(),
            });
        }

        const trigger = detectMessageTrigger({ body: msgBody, payload, state: botTriggerState, isDM });
        if (!trigger) {
            if (isGroup) {
                const category = autoCategorize(msgBody);
                if (shouldConsiderProactive({ groupId: chatId, category, msgBody })) {
                    const cooldown = checkProactiveCooldown(chatId);
                    if (cooldown.allowed) {
                        record(`${source}-proactive-candidate`, {
                            category,
                            senderName,
                            chatId,
                            msgPreview: previewText(msgBody),
                        });

                        await withChatLock(chatId, async () => {
                            const canonicalSenderJid = await resolveCanonicalSender(senderJid);
                            const askAI = makeAskAI(chatId, senderName, canonicalSenderJid);

                            chatContext.proactiveMode = true;

                            let reply = await handleNaturalLanguage(msgBody, chatId, senderName, askAI, chatContext, canonicalSenderJid);

                            if (!reply || reply.includes(PROACTIVE_SKIP_MARKER)) {
                                record(`${source}-proactive-skipped`, {
                                    reason: !reply ? 'no-reply' : 'ai-skip',
                                    chatId,
                                });
                                return;
                            }

                            markProactiveSent(chatId);

                            const dms = extractDMs(reply);
                            reply = stripDMTags(reply);

                            if (dms.length > 0) {
                                record(`${source}-proactive-dms-detected`, { count: dms.length });
                                for (const dm of dms) {
                                    let target = dm.target;
                                    if (!target.includes('@')) {
                                        target += '@c.us';
                                    }
                                    await sendWA(dm.message, target);
                                    record(`${source}-proactive-dm-sent`, { target, preview: previewText(dm.message) });
                                }
                            }

                            if (!reply) return;

                            let finalReply = reply;
                            let mentions = [];
                            if (roster && roster.participants) {
                                const intents = extractMentionIntents(reply, roster.participants);
                                if (intents.length > 0) {
                                    const now = Date.now();
                                    const lastMention = mentionCooldownStore.get(chatId);
                                    if (now - lastMention >= MENTION_COOLDOWN_MS) {
                                        const formatted = formatMentionedReply(reply, intents);
                                        finalReply = formatted.text;
                                        mentions = formatted.mentions;
                                        mentionCooldownStore.set(chatId, now);
                                    }
                                }
                            }

                            record(`${source}-proactive-reply`, {
                                chatId,
                                senderName,
                                replyPreview: previewText(finalReply),
                                mentionCount: mentions.length,
                            });
                            await sendWA(finalReply, chatId, mentions);
                        });
                        return;
                    } else {
                        record(`${source}-proactive-cooldown`, {
                            chatId,
                            remainingMs: cooldown.remainingMs,
                        });
                    }
                }
            }

            record(`${source}-no-trigger`, {
                payload: summarizePayload(body, payload, chatId, senderJid),
                state: summarizeBotState(),
            });
            return;
        }
        if (isRateLimited(senderJid)) {
            record(`${source}-rate-limited`, {
                trigger,
                senderName,
                payload: summarizePayload(body, payload, chatId, senderJid),
            });
            return;
        }

        record(`${source}-trigger-detected`, {
            trigger,
            senderName,
            payload: summarizePayload(body, payload, chatId, senderJid),
            state: summarizeBotState(),
        });
        console.log(`[Msg] ${senderName} | ${trigger} | "${msgBody.substring(0, 50)}"`);

        await withChatLock(chatId, async () => {
            const canonicalSenderJid = await resolveCanonicalSender(senderJid);
            const askAI = makeAskAI(chatId, senderName, canonicalSenderJid);

            let reply = null;
            if (trigger === 'cmd') {
                reply = await processCommand(msgBody, chatId, askAI);
            } else {
                reply = await handleNaturalLanguage(msgBody, chatId, senderName, askAI, chatContext, canonicalSenderJid);
            }

            if (!reply) {
                record(`${source}-no-reply-generated`, {
                    trigger,
                    senderName,
                    payload: summarizePayload(body, payload, chatId, senderJid),
                });
                return;
            }

            const dms = extractDMs(reply);
            reply = stripDMTags(reply);

            if (dms.length > 0) {
                record(`${source}-dms-detected`, { count: dms.length });
                for (const dm of dms) {
                    let target = dm.target;
                    if (!target.includes('@')) {
                        target += '@c.us';
                    }
                    await sendWA(dm.message, target);
                    record(`${source}-dm-sent`, { target, preview: previewText(dm.message) });
                }
            }

            if (!reply) return;

            record(`${source}-reply-generated`, {
                trigger,
                senderName,
                chatId,
                replyPreview: previewText(reply),
            });

            let mentions = [];
            if (isGroup && roster && roster.participants) {
                const intents = extractMentionIntents(reply, roster.participants);
                if (intents.length > 0) {
                    const now = Date.now();
                    const lastMention = mentionCooldownStore.get(chatId);
                    if (now - lastMention >= MENTION_COOLDOWN_MS) {
                        const formatted = formatMentionedReply(reply, intents);
                        reply = formatted.text;
                        mentions = formatted.mentions;
                        mentionCooldownStore.set(chatId, now);
                        record(`${source}-mentions-applied`, {
                            mentionCount: mentions.length,
                            intents: intents.map(i => ({ matched: i.matchedText, id: i.participant.id })),
                        });
                    } else {
                        record(`${source}-mentions-cooldown`, {
                            chatId,
                            cooldownRemainingMs: MENTION_COOLDOWN_MS - (now - lastMention),
                        });
                    }
                }
            }

            const sendResult = await sendWA(reply, chatId, mentions);
            record(sendResult.ok ? `${source}-reply-sent` : `${source}-reply-send-failed`, {
                trigger,
                senderName,
                chatId,
                error: sendResult.error || null,
            });
        });
    };
};

module.exports = { createWebhookProcessor };
```

NOTE: this is a near-verbatim move. The only changes vs the original:
- Module-level imports moved into the file header.
- All dependencies referenced via factory params, not closure over server.js scope.
- All `lifecycle` and other unused-here references removed.

- [ ] **Step 4: Update server.js**

In `server.js`:

a. Find the entire `processIncomingPayload` definition (lines ~606-890). REMOVE it entirely. Keep the `// 9. WEBHOOK` section header.

b. Add import in the require block near the top:

```javascript
const { createWebhookProcessor } = require('./modules/webhookProcessor');
```

c. After all dependencies are defined (sendWA, makeAskAI, processCommand, handleNaturalLanguage, dedup helpers, mentionCooldownStore, etc.), construct the processor. Best location: right after `processCommand` is created (which you did in Task 2). Add:

```javascript
const processIncomingPayload = createWebhookProcessor({
    sendWA,
    makeAskAI,
    processCommand,
    handleNaturalLanguage,
    summarizePayload,
    resolveCanonicalSender,
    hasProcessedIncoming,
    markProcessedIncoming,
    isRateLimited,
    summarizeBotState,
    botTriggerState,
    groupRosterClient,
    lidResolver,
    mentionCooldownStore,
    GROUP_ID,
    MENTION_COOLDOWN_MS,
});
```

PLACEMENT MATTERS: all named dependencies must be defined BEFORE this call. Verify order — `handleNaturalLanguage` is currently defined at ~line 564, so the createWebhookProcessor call must come AFTER that line.

d. The existing call sites of `processIncomingPayload` (in the webhook handler ~line 920, in `pollWahaChats` ~line 1099, in `/debug/waha/process-latest` ~line 1041) should work unchanged — they all call `processIncomingPayload({body, payload, record, source})`.

- [ ] **Step 5: Run tests**

Run from `D:/Website/bot-projects/bot_wa`:

```bash
node --test test/webhookProcessor.test.js
node --test 2>&1 | grep -E "^# (tests|pass|fail)"
node -c server.js modules/webhookProcessor.js
```

Expected:
- `webhookProcessor.test.js`: 3 PASS.
- Full suite: 193/193 (190 + 3 new) PASS.
- syntax clean.

If the full suite fails: likely a placement issue (something referenced before defined). Check the order of declarations in server.js.

- [ ] **Step 6: Commit**

```bash
git add modules/webhookProcessor.js test/webhookProcessor.test.js server.js
git commit -m "refactor(server): extract processIncomingPayload to modules/webhookProcessor.js"
```

---

## Self-Review

**Spec coverage:**
- Crypto extraction → Task 1.
- processCommand extraction → Task 2.
- processIncomingPayload extraction → Task 3.

**Placeholder scan:** No TBD / "implement later" / "similar to Task N — repeat the code"-style references.

**Type consistency:**
- `processCommand` (server.js variable) is now the return value of `createCommandHandler(...)` instead of an inline arrow function. Same call signature `(msg, chatId, askAI) => Promise<string|null>` — unchanged at call sites.
- `processIncomingPayload` (server.js variable) is now the return value of `createWebhookProcessor(...)`. Same call signature `({body, payload, record, source, force}) => Promise<void>` — unchanged at call sites.
- All factory deps named consistently across plan + test + implementation.

**Test isolation:**
- crypto test: smoke + network behavior on invalid coin (graceful 'N/A').
- commands test: smoke + parseWaktu pure tests + dispatch routing for /help, /reset, non-command.
- webhookProcessor test: smoke + filter-broadcast scenario with stub deps.
- The full suite (179 → 193 tests by end of Task 3) is the primary regression guard. No test in the existing suite directly tests server.js routes, so extractions are invisible to existing tests as long as behavior is preserved.

**Ordering rationale:**
- Task 1 (crypto): pure functions, lowest risk → warm up.
- Task 2 (commands): factory with 2 injected deps, dispatcher pattern → medium risk.
- Task 3 (webhookProcessor): factory with 14+ injected deps, heart of the bot → highest risk.
- Each task fully independent — abort after Task 1 or Task 2 if needed.

**Out-of-scope:**
- `makeAskAI` extraction (Aggressive option).
- `handleNaturalLanguage` extraction (Aggressive option).
- Debug routes extraction (Full option).
- `pollWahaChats` extraction (Aggressive option).
- `sendWA` extraction (Full option).
- These remain in server.js — if user wants Full or Aggressive later, plan separately.

**Final server.js estimated size:** ~680 baris (down from 1146). Wire-up + routes (webhook + debug + health) + scheduler + polling + init + remaining helpers (sendWA, makeAskAI, handleNaturalLanguage, summarizePayload, dedup, debugStatus).
