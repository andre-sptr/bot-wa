# Tier-1 Resilience Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hilangkan empat lubang resilience produksi paling berdampak: dedup race window, in-memory cooldown yang hilang saat restart, ketiadaan graceful fallback saat Anthropic gagal permanen, dan tidak adanya graceful shutdown.

**Architecture:** Empat perbaikan terisolasi, masing-masing modul-local:
- **B** (race): satu baris dipindah — atomic check-then-mark di webhook processor.
- **A** (persist cooldown): tambah lapisan persist tipis di `proactiveGuard` & helper baru `cooldownStore` untuk `mentionCooldownMap`. Load saat start, save tiap update.
- **C** (Anthropic resilience): naikkan `maxRetries`+timeout eksplisit, tambahkan satu pesan fallback dari `makeAskAI` saat gagal (bukan `null` mentah).
- **D** (shutdown): satu modul baru `lifecycle.js` yang me-wire SIGTERM/SIGINT → stop polling + stop cron + flush storage + close express server.

**Tech Stack:** Node.js + node:test (TDD), `storage.js` (file JSON yang sudah ada), `node-cron`, `@anthropic-ai/sdk`.

**Grounding facts (terverifikasi 2026-05-31):**
- Anthropic SDK TS sudah default `maxRetries=2` dengan exponential backoff 0.5s→8s + 25% jitter dan respect `Retry-After`. Jadi kita tidak menambah retry — kita menaikkan ke 3 + timeout 30s + fallback message ramah saat tetap gagal.
- `withChatLock(chatId)` di [chatContext.js:18](../../chatContext.js:18) sudah ada → kita pakai sebagai tempat untuk atomic check-then-mark.
- Test memakai `process.env.BOT_DATA_DIR = TMP` untuk isolasi. Pattern ini wajib diikuti test baru.

---

## File Structure

**Modify:**
- `server.js` (race fix, Anthropic config, fallback, wire lifecycle, persist mention cooldown)
- `modules/proactiveGuard.js` (persist proactiveCooldownMap)

**Create:**
- `modules/cooldownStore.js` (helper persist Map<groupId, timestamp>; dipakai untuk mentionCooldownMap)
- `modules/lifecycle.js` (graceful shutdown registry)
- `test/cooldownStore.test.js`
- `test/proactiveGuardPersist.test.js`
- `test/lifecycle.test.js`
- `test/dedupRace.test.js`

---

## Task 1: Fix dedup race window (B)

**Goal:** Atomic check-then-mark — pesan duplikat dari webhook+poll tidak bisa lolos dua-duanya.

**Files:**
- Test: `test/dedupRace.test.js` (create)
- Modify: `server.js:637-642` (move `markProcessedIncoming` up — eksekusi sebelum any `await`)

- [ ] **Step 1: Tulis failing test**

File: `test/dedupRace.test.js`

```javascript
// Race fix: check + mark harus atomic (sync) supaya dua proses concurrent
// tidak bisa lolos dua-duanya.

const test = require('node:test');
const assert = require('node:assert/strict');

// Helper kecil yang meniru logika check-then-mark di server.js
// (kita test logikanya — eksekusi server.js end-to-end butuh terlalu banyak mock).
const makeDedupGate = (max = 500) => {
    const seen = new Set();
    const ids = (payload) => {
        const raw = payload?.id || payload?._data?.id;
        return raw ? [String(raw)] : [];
    };
    const checkAndMark = (payload) => {
        const list = ids(payload);
        if (list.length === 0) return { duplicate: false };
        if (list.some(id => seen.has(id))) return { duplicate: true };
        for (const id of list) {
            seen.add(id);
            while (seen.size > max) {
                const oldest = seen.values().next().value;
                seen.delete(oldest);
            }
        }
        return { duplicate: false };
    };
    return { checkAndMark, size: () => seen.size };
};

test('checkAndMark first call passes, second on same id is duplicate', () => {
    const gate = makeDedupGate();
    assert.equal(gate.checkAndMark({ id: 'msg-1' }).duplicate, false);
    assert.equal(gate.checkAndMark({ id: 'msg-1' }).duplicate, true);
});

test('checkAndMark different ids both pass', () => {
    const gate = makeDedupGate();
    assert.equal(gate.checkAndMark({ id: 'a' }).duplicate, false);
    assert.equal(gate.checkAndMark({ id: 'b' }).duplicate, false);
});

test('checkAndMark capacity caps to max', () => {
    const gate = makeDedupGate(3);
    for (let i = 0; i < 10; i++) gate.checkAndMark({ id: `m-${i}` });
    assert.equal(gate.size(), 3);
});

test('checkAndMark with empty payload returns non-duplicate', () => {
    const gate = makeDedupGate();
    assert.equal(gate.checkAndMark({}).duplicate, false);
});
```

- [ ] **Step 2: Run test untuk verifikasi PASS sekarang (sanity)**

Run: `node --test test/dedupRace.test.js`

Expected: 4 PASS (test helper-level — meng-encode invariant yang harus dijaga server.js).

- [ ] **Step 3: Apply atomic check-then-mark di server.js**

Modify `server.js` di sekitar baris 637 — pindah `markProcessedIncoming` agar dieksekusi SEBELUM `await` apa pun.

Cari blok:

```javascript
    if (!force && hasProcessedIncoming(payload)) {
        record(`${source}-duplicate`, {
            payload: summarizePayload(body, payload, chatId),
        });
        return;
    }

    // Sender identification (notifyName lives in _data)
```

Ganti dengan:

```javascript
    if (!force && hasProcessedIncoming(payload)) {
        record(`${source}-duplicate`, {
            payload: summarizePayload(body, payload, chatId),
        });
        return;
    }
    // Atomic mark BEFORE any await so concurrent webhook+poll cannot both pass.
    if (!force) markProcessedIncoming(payload);

    // Sender identification (notifyName lives in _data)
```

Lalu hapus dua `markProcessedIncoming(payload);` redundant di:
- Baris ~700 (dalam proactive branch, sebelum `withChatLock`)
- Baris ~788 (di `else` trigger branch, sebelum `console.log`)

- [ ] **Step 4: Verify full test suite tetap hijau**

Run: `node --test`

Expected: semua test PASS, tidak ada regresi.

- [ ] **Step 5: Sanity-check syntax server.js**

Run: `node -c server.js`

Expected: no output (parses cleanly).

- [ ] **Step 6: Commit**

```bash
git add test/dedupRace.test.js server.js
git commit -m "fix: atomic check-then-mark dedup to close webhook+poll race"
```

---

## Task 2: Persist proactiveCooldownMap (A.1)

**Goal:** Saat restart, cooldown 5 menit per-grup tidak hilang → tidak ada burst spam.

**Files:**
- Test: `test/proactiveGuardPersist.test.js` (create)
- Modify: `modules/proactiveGuard.js`

- [ ] **Step 1: Tulis failing test**

File: `test/proactiveGuardPersist.test.js`

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proactive-persist-'));
process.env.BOT_DATA_DIR = tmpDir;

// Fresh require setiap test agar in-memory map proactiveGuard ke-reset.
const reloadModule = () => {
    delete require.cache[require.resolve('../modules/proactiveGuard')];
    delete require.cache[require.resolve('../modules/storage')];
    return require('../modules/proactiveGuard');
};

test('cooldown timestamp persisted to storage after markProactiveSent', () => {
    const guard = reloadModule();
    guard.markProactiveSent('persist-1@g.us');

    // Test isolation menggunakan storage langsung — verifikasi file dibuat.
    const storage = require('../modules/storage');
    const data = storage.load('proactive_cooldowns', null);
    assert.ok(data, 'proactive_cooldowns harus tersimpan');
    assert.ok(typeof data['persist-1@g.us'] === 'number', 'timestamp groupId tersimpan');
});

test('cooldown reloaded from storage on module reinit', () => {
    // Sesi pertama: mark sent.
    let guard = reloadModule();
    guard.markProactiveSent('persist-2@g.us');

    // Sesi kedua: re-require → harus baca dari disk.
    guard = reloadModule();
    const result = guard.checkProactiveCooldown('persist-2@g.us');
    assert.equal(result.allowed, false, 'cooldown masih aktif setelah reload');
    assert.ok(result.remainingMs > 0, 'remainingMs > 0');
});

test('expired cooldowns are dropped on reinit (housekeeping)', () => {
    // Tulis manual timestamp jauh di masa lalu.
    const storage = require('../modules/storage');
    storage.save('proactive_cooldowns', {
        'stale@g.us': Date.now() - 3_600_000, // 1 jam lalu, cooldown 5 menit → expired
    });

    const guard = reloadModule();
    const result = guard.checkProactiveCooldown('stale@g.us');
    assert.equal(result.allowed, true);
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test untuk verifikasi FAIL**

Run: `node --test test/proactiveGuardPersist.test.js`

Expected: FAIL — `proactive_cooldowns` belum disimpan.

- [ ] **Step 3: Implement persistence di proactiveGuard.js**

Modify `modules/proactiveGuard.js` — tambah load/save dan housekeeping. Ganti blok cooldown menjadi:

```javascript
// ── Cooldown (persisted; in-memory mirror) ───────────────────────

const COOLDOWN_STORAGE_KEY = 'proactive_cooldowns';

const loadCooldownsFromDisk = () => {
    const data = storage.load(COOLDOWN_STORAGE_KEY, null);
    const map = new Map();
    if (!data || typeof data !== 'object') return map;
    const now = Date.now();
    for (const [groupId, ts] of Object.entries(data)) {
        // Drop entries yang sudah expired (housekeeping otomatis).
        if (typeof ts === 'number' && now - ts < PROACTIVE_COOLDOWN_MS) {
            map.set(groupId, ts);
        }
    }
    return map;
};

const proactiveCooldownMap = loadCooldownsFromDisk();

const persistCooldowns = () => {
    const obj = {};
    for (const [k, v] of proactiveCooldownMap.entries()) obj[k] = v;
    storage.save(COOLDOWN_STORAGE_KEY, obj);
};

const checkProactiveCooldown = (groupId, cooldownMs = PROACTIVE_COOLDOWN_MS) => {
    const now = Date.now();
    const last = proactiveCooldownMap.get(groupId) || 0;
    const elapsed = now - last;

    if (elapsed >= cooldownMs) {
        return { allowed: true, remainingMs: 0 };
    }
    return { allowed: false, remainingMs: cooldownMs - elapsed };
};

const markProactiveSent = (groupId) => {
    proactiveCooldownMap.set(groupId, Date.now());
    persistCooldowns();
};

const resetProactiveCooldown = (groupId) => {
    proactiveCooldownMap.delete(groupId);
    persistCooldowns();
};
```

(Jangan ubah `module.exports` — fungsi yang dipakai tetap sama.)

- [ ] **Step 4: Run test untuk verifikasi PASS**

Run: `node --test test/proactiveGuardPersist.test.js`

Expected: 3 PASS.

- [ ] **Step 5: Run full suite (no regressions)**

Run: `node --test`

Expected: semua test PASS termasuk `proactiveGuard.test.js` lama.

- [ ] **Step 6: Commit**

```bash
git add test/proactiveGuardPersist.test.js modules/proactiveGuard.js
git commit -m "fix(proactive): persist cooldown map across restart to prevent burst"
```

---

## Task 3: Persist mention cooldown via cooldownStore (A.2)

**Goal:** `mentionCooldownMap` di server.js juga survive restart. Bikin helper generik.

**Files:**
- Create: `modules/cooldownStore.js`
- Create: `test/cooldownStore.test.js`
- Modify: `server.js` (replace `mentionCooldownMap = new Map()` dengan store)

- [ ] **Step 1: Tulis failing test**

File: `test/cooldownStore.test.js`

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cooldown-store-'));
process.env.BOT_DATA_DIR = tmpDir;

const reload = () => {
    delete require.cache[require.resolve('../modules/cooldownStore')];
    delete require.cache[require.resolve('../modules/storage')];
    return require('../modules/cooldownStore');
};

test('createCooldownStore: get returns 0 for unknown key', () => {
    const { createCooldownStore } = reload();
    const store = createCooldownStore({ storageKey: 'cd-1', ttlMs: 60_000 });
    assert.equal(store.get('unknown'), 0);
});

test('createCooldownStore: set + get roundtrip in same instance', () => {
    const { createCooldownStore } = reload();
    const store = createCooldownStore({ storageKey: 'cd-2', ttlMs: 60_000 });
    const ts = Date.now();
    store.set('grp-a', ts);
    assert.equal(store.get('grp-a'), ts);
});

test('createCooldownStore: persists across reload', () => {
    let mod = reload();
    let store = mod.createCooldownStore({ storageKey: 'cd-3', ttlMs: 60_000 });
    const ts = Date.now();
    store.set('grp-b', ts);

    mod = reload();
    store = mod.createCooldownStore({ storageKey: 'cd-3', ttlMs: 60_000 });
    assert.equal(store.get('grp-b'), ts);
});

test('createCooldownStore: drops expired entries on load (housekeeping)', () => {
    const storage = require('../modules/storage');
    storage.save('cd-4', { stale: Date.now() - 999_999 });

    const { createCooldownStore } = reload();
    const store = createCooldownStore({ storageKey: 'cd-4', ttlMs: 5_000 });
    assert.equal(store.get('stale'), 0);
});

test.after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test untuk verifikasi FAIL**

Run: `node --test test/cooldownStore.test.js`

Expected: FAIL — module `cooldownStore` belum ada.

- [ ] **Step 3: Implement modules/cooldownStore.js**

Create file:

```javascript
// Persisted cooldown store. Generic helper: load from storage at construct time,
// auto-drop expired entries, persist on every set/delete.

const storage = require('./storage');

const createCooldownStore = ({ storageKey, ttlMs }) => {
    if (!storageKey) throw new Error('cooldownStore: storageKey required');
    const map = new Map();

    const load = () => {
        const data = storage.load(storageKey, null);
        if (!data || typeof data !== 'object') return;
        const now = Date.now();
        for (const [k, ts] of Object.entries(data)) {
            if (typeof ts === 'number' && now - ts < ttlMs) map.set(k, ts);
        }
    };
    load();

    const persist = () => {
        const obj = {};
        for (const [k, v] of map.entries()) obj[k] = v;
        storage.save(storageKey, obj);
    };

    return {
        get: (key) => map.get(key) || 0,
        set: (key, ts) => { map.set(key, ts); persist(); },
        delete: (key) => { map.delete(key); persist(); },
    };
};

module.exports = { createCooldownStore };
```

- [ ] **Step 4: Run test untuk verifikasi PASS**

Run: `node --test test/cooldownStore.test.js`

Expected: 4 PASS.

- [ ] **Step 5: Wire ke server.js**

Modify `server.js`:

a. Tambah import di kelompok require modul (~line 48):

```javascript
const { createCooldownStore } = require('./modules/cooldownStore');
```

b. Ganti baris (~line 77):

```javascript
const mentionCooldownMap = new Map();
const MENTION_COOLDOWN_MS = 5_000; // 5s cooldown per group for mentions
```

menjadi:

```javascript
const MENTION_COOLDOWN_MS = 5_000; // 5s cooldown per group for mentions
const mentionCooldownStore = createCooldownStore({
    storageKey: 'mention_cooldowns',
    ttlMs: MENTION_COOLDOWN_MS,
});
```

c. Ganti semua pembacaan `mentionCooldownMap.get(chatId) || 0` jadi `mentionCooldownStore.get(chatId)` dan `mentionCooldownMap.set(chatId, now)` jadi `mentionCooldownStore.set(chatId, now)` (dua tempat: proactive branch ~baris 744-750 dan normal trigger branch ~baris 848-853).

- [ ] **Step 6: Full suite + syntax check**

Run: `node --test && node -c server.js`

Expected: semua PASS, no syntax error.

- [ ] **Step 7: Commit**

```bash
git add modules/cooldownStore.js test/cooldownStore.test.js server.js
git commit -m "fix(cooldown): persist mention cooldown across restart via cooldownStore"
```

---

## Task 4: Anthropic resilience config + graceful fallback (C)

**Goal:** Naikkan retry budget eksplisit, set timeout, dan saat tetap gagal user lihat pesan ramah (bukan bot diam).

**Files:**
- Modify: `server.js` (Anthropic client init + makeAskAI)

(Tidak ada test baru — perubahan setting + fallback string yang dites manual karena pemanggilan SDK mocked = invasif.)

- [ ] **Step 1: Naikkan client config Anthropic**

Modify `server.js`. Cari (~line 67):

```javascript
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
```

Ganti dengan:

```javascript
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 3,        // default 2; +1 untuk transient 429/5xx
    timeout: 30_000,      // 30s per request, ditambah retry budget
});
```

- [ ] **Step 2: Tambah graceful fallback di makeAskAI**

Modify `server.js` di blok catch `makeAskAI` (~line 208-211). Cari:

```javascript
    } catch (error) {
        console.error('Error AI:', error?.message || error);
        return null;
    }
```

Ganti dengan:

```javascript
    } catch (error) {
        console.error('Error AI:', error?.message || error);
        // Setelah SDK retry budget habis: jangan bisu — kasih sinyal ramah.
        // null hanya untuk kasus tertentu (mis. summarizeConversation) supaya caller bisa
        // kasih message-nya sendiri; di sini chat normal punya chatId+sender → reply fallback.
        if (!chatId) return null;
        return 'Bubu lagi nge-lag bentar nih, coba lagi ya sebentar.';
    }
```

- [ ] **Step 3: Verify syntax + tests masih hijau**

Run: `node -c server.js && node --test`

Expected: parse OK, semua test PASS (test tidak hit Anthropic real).

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(ai): explicit Anthropic retry+timeout config and graceful fallback message"
```

---

## Task 5: Graceful shutdown (D)

**Goal:** SIGTERM/SIGINT → stop polling + stop cron jobs + close express server + final flush — supaya restart bersih.

**Files:**
- Create: `modules/lifecycle.js`
- Create: `test/lifecycle.test.js`
- Modify: `server.js`

- [ ] **Step 1: Tulis failing test**

File: `test/lifecycle.test.js`

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');

const reload = () => {
    delete require.cache[require.resolve('../modules/lifecycle')];
    return require('../modules/lifecycle');
};

test('register + shutdown calls hooks in reverse registration order', async () => {
    const { register, shutdown } = reload();
    const order = [];
    register('a', async () => { order.push('a'); });
    register('b', async () => { order.push('b'); });
    register('c', async () => { order.push('c'); });
    await shutdown('TEST');
    assert.deepEqual(order, ['c', 'b', 'a']);
});

test('shutdown swallows errors and continues calling remaining hooks', async () => {
    const { register, shutdown } = reload();
    const called = [];
    register('ok-1', async () => { called.push('ok-1'); });
    register('boom', async () => { throw new Error('boom'); });
    register('ok-2', async () => { called.push('ok-2'); });
    await shutdown('TEST');
    // ok-2 runs first (reverse), boom errors, ok-1 still runs.
    assert.deepEqual(called, ['ok-2', 'ok-1']);
});

test('shutdown is idempotent (second call is no-op)', async () => {
    const { register, shutdown } = reload();
    let count = 0;
    register('once', async () => { count++; });
    await shutdown('TEST');
    await shutdown('TEST');
    assert.equal(count, 1);
});
```

- [ ] **Step 2: Run test untuk verifikasi FAIL**

Run: `node --test test/lifecycle.test.js`

Expected: FAIL — module belum ada.

- [ ] **Step 3: Implement modules/lifecycle.js**

Create file:

```javascript
// Graceful shutdown registry. Hook order: LIFO (last registered runs first).
// Errors di satu hook tidak menghentikan hook lain.

const hooks = [];
let isShuttingDown = false;

const register = (name, fn) => {
    if (typeof fn !== 'function') throw new Error('lifecycle: fn required');
    hooks.push({ name, fn });
};

const shutdown = async (signal = 'SIGTERM') => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`[Lifecycle] shutdown start (${signal}), ${hooks.length} hooks`);

    // LIFO: hook terakhir di-register harus berhenti duluan
    // (mis. polling interval di-register setelah express listen).
    for (let i = hooks.length - 1; i >= 0; i--) {
        const { name, fn } = hooks[i];
        try {
            await fn();
            console.log(`[Lifecycle] hook "${name}" OK`);
        } catch (err) {
            console.error(`[Lifecycle] hook "${name}" failed:`, err?.message || err);
        }
    }
    console.log('[Lifecycle] shutdown complete');
};

const installSignalHandlers = ({ exit = true } = {}) => {
    const handle = (signal) => async () => {
        await shutdown(signal);
        if (exit) process.exit(0);
    };
    process.on('SIGTERM', handle('SIGTERM'));
    process.on('SIGINT', handle('SIGINT'));
};

// Test helper: reset state antara test run (tidak diekspos sebagai API publik).
const _resetForTests = () => {
    hooks.length = 0;
    isShuttingDown = false;
};

module.exports = { register, shutdown, installSignalHandlers, _resetForTests };
```

Catatan: Test file pakai `delete require.cache` jadi `_resetForTests` tidak strictly needed, tapi exposed untuk safety.

- [ ] **Step 4: Run test untuk verifikasi PASS**

Run: `node --test test/lifecycle.test.js`

Expected: 3 PASS.

- [ ] **Step 5: Wire lifecycle di server.js**

Modify `server.js`:

a. Tambah import (~baris 48):

```javascript
const lifecycle = require('./modules/lifecycle');
```

b. Tangkap handle ke polling interval dan express server. Cari (~baris 1111-1115):

```javascript
if (WAHA_POLL_INTERVAL_MS && WAHA_POLL_INTERVAL_MS >= 1000) {
    pollWahaChats();
    setInterval(pollWahaChats, WAHA_POLL_INTERVAL_MS);
    console.log(`[Poll] WAHA chat fallback aktif tiap ${WAHA_POLL_INTERVAL_MS}ms`);
}
```

Ganti dengan:

```javascript
let pollInterval = null;
if (WAHA_POLL_INTERVAL_MS && WAHA_POLL_INTERVAL_MS >= 1000) {
    pollWahaChats();
    pollInterval = setInterval(pollWahaChats, WAHA_POLL_INTERVAL_MS);
    console.log(`[Poll] WAHA chat fallback aktif tiap ${WAHA_POLL_INTERVAL_MS}ms`);
    lifecycle.register('stop-poll', () => clearInterval(pollInterval));
}
```

c. Cari baris akhir (~baris 1121):

```javascript
app.listen(PORT, () => console.log(`Bubu Bot aktif di port ${PORT}`));
```

Ganti dengan:

```javascript
const httpServer = app.listen(PORT, () => console.log(`Bubu Bot aktif di port ${PORT}`));

lifecycle.register('close-http', () => new Promise((resolve) => {
    httpServer.close(() => resolve());
    // Forced timeout: jangan hang lebih dari 5 detik.
    setTimeout(resolve, 5_000).unref();
}));

lifecycle.installSignalHandlers();
```

- [ ] **Step 6: Full suite + syntax check**

Run: `node --test && node -c server.js`

Expected: semua PASS, parse OK.

- [ ] **Step 7: Smoke test manual (opsional, ringkas)**

Jika ada akses ke env env-nya:

Run di terminal terpisah:

```bash
node server.js &
PID=$!
sleep 2
kill -TERM $PID
wait $PID
```

Expected output mengandung `[Lifecycle] shutdown start (SIGTERM)`, `hook "close-http" OK`, `shutdown complete`. Process exit 0.

- [ ] **Step 8: Commit**

```bash
git add modules/lifecycle.js test/lifecycle.test.js server.js
git commit -m "feat(lifecycle): graceful shutdown for poll, http, and registered hooks"
```

---

## Self-Review

**Spec coverage:**
- A (in-memory state hilang) → Task 2 (proactive), Task 3 (mention). `rateLimitMap` (3s) & `recentBotMessageIds` (rolling) sengaja dilepas — dampak terlalu kecil; `lidResolver` cache out-of-scope (akan ke-fetch ulang on-demand, satu hit per LID).
- B (race) → Task 1.
- C (Anthropic) → Task 4 (eksplisit retry+timeout+fallback message).
- D (graceful shutdown) → Task 5.

**Placeholder scan:** Tidak ada "TBD", "implement later", atau test placeholder tanpa code.

**Type consistency:**
- `cooldownStore.get/set/delete` konsisten di test & impl & server.js wiring.
- `lifecycle.register/shutdown/installSignalHandlers/_resetForTests` konsisten di test & impl.
- `proactive_cooldowns` storage key konsisten di test & impl.

**Test isolation:** Semua test baru pakai `process.env.BOT_DATA_DIR = TMP` + cleanup `after()` mengikuti pattern `test/persistence.test.js` & `test/proactiveGuard.test.js`.

**Ordering rationale:** Task 1 paling kecil & lowest risk → ground confidence. Task 2-3 menambah infrastruktur persist. Task 4 satu file local. Task 5 wire-up terakhir karena bergantung pada server.js sudah stabil.
