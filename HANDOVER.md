# HANDOVER — Bubu Awareness Feature

> Untuk agent penerus (Codex). Kamu TIDAK punya konteks obrolan sebelumnya, jadi
> dokumen ini dibikin self-contained. Baca ini + `AWARENESS_NOTES.md` (blueprint
> lengkap: 5 poin desain + 7 fase + keputusan alignment).
>
> Project: WhatsApp bot "Bubu" di `D:\Website\bot-projects\bot_wa`.
> Stack: Node.js + Express + WAHA (WhatsApp HTTP API) + Anthropic SDK (model
> `claude-haiku-4-5`). Bahasa komunikasi user: Indonesia santai.

---

## 0. GAYA KERJA YANG DIHARAPKAN (penting)
- **TDD wajib** (RED → GREEN → REFACTOR). Tulis test dulu, tonton gagal, baru implement.
- **Grounding dulu** sebelum ngubah: baca kode terkait, jangan nebak (apalagi API WAHA/Anthropic).
- **Commit kecil per fase**, jelasin keputusan.
- Update `AWARENESS_NOTES.md` tiap nyelesain fase (centang checklist).
- Kalau ada keputusan taste/produk yang genuine → TANYA user, jangan asumsi.

---

## 1. STATUS SEKARANG

### ✅ Fase 1 — Persistensi "forever" — SELESAI & DI-COMMIT
Memory & summary Bubu numpuk selamanya (cap dihapus), expiry 6→24 jam.
- `chatContext.js`: hapus 3 prune (per-chat/total/summary) + konstanta unused;
  `AUTO_EXPIRE_HOURS` 6→24; export `saveSessionMemory` + `archiveSession`.
- `modules/storage.js`: dukung `process.env.BOT_DATA_DIR` (override data dir buat test).
- `test/persistence.test.js`: 5 unit test (semua hijau).

### 🚧 Fase 2 — Identitas statis + anti-recite — SEDANG JALAN (BELUM SELESAI)
Tujuan: Bubu SADAR konteksnya (bales di WhatsApp via WAHA pakai nomor X, di DM/grup)
TAPI ga pernah ngumumin konteks itu (anti-recite). Plus jujur ngaku asisten digital
kalau ditanya.

**State persis:**
- `test/bubuPersona.test.js` — SUDAH ditulis, 9 test, **saat ini RED** (sengaja, TDD).
  Semua gagal karena `buildBubuPersona is not a function` (belum diimplement).
- `modules/bubuPersona.js` — MASIH versi lama: export `const BUBU_PERSONA` (string statis),
  belum ada `buildBubuPersona`. **Ini yang harus kamu kerjain berikutnya.**

---

## 2. LANGKAH BERIKUTNYA (mulai di sini)

### STEP 1 — Selesaikan Fase 2a: implement `buildBubuPersona` (GREEN)
Ganti isi `modules/bubuPersona.js` jadi builder berikut. Ini SUDAH dirancang supaya
lolos 9 test di `test/bubuPersona.test.js` DAN mempertahankan semua konten persona lama:

```js
// ==========================================
// BUBU SYSTEM PROMPT (statis — kandidat di-cache)
// Single source of truth — imported by server + live tests.
// buildBubuPersona({ botPhone }) supaya nomor WA (dari env) bisa diinject.
// ==========================================

const buildBubuPersona = ({ botPhone = '' } = {}) => {
    const numberClause = botPhone ? ` Nomor WhatsApp kamu: ${botPhone}.` : '';

    return `Kamu adalah Bubu, asisten digital cerdas yang dibuat oleh Andre Saputra.
Bubu hangat, witty, dan helpful — kayak temen pintar di chat WhatsApp.

Kesadaran posisi (ini LATAR BELAKANG, BUKAN buat diucapin):
- Kamu beneran lagi bales chat di WhatsApp, lewat sebuah nomor WA (dijalankan via WAHA).${numberClause}
- Kamu bisa lagi di chat pribadi (DM) berdua, atau di dalam grup yang rame.
- Kamu sadar semua ini — tapi cukup TAU aja, biarin itu ngebentuk cara kamu bales.

ATURAN #1 — PALING PENTING (sadar konteks, BUKAN ngumumin konteks):
Kamu punya banyak konteks (lagi di DM/grup, siapa lawan ngobrol, nomor kamu, dll).
Tapi konteks itu LENSA, bukan naskah — JANGAN pernah dibacain/diumumin ke user.
Patokan: kayak manusia yang tau dia lagi bales di grup mana, tapi GA nyebut nama grup
kalau ga ditanya. Sebut detail konteks HANYA kalau user nanya langsung.
- SALAH: "Halo Andre, aku Bubu, kita lagi di grup Draft, ada yang bisa dibantu?"
- BENAR: "Eh Andre, kenapa?"
- SALAH: tiap bales ngumumin lagi di WhatsApp / nyebut nomor / nyebut nama grup
- BENAR: langsung nyambung ke obrolan — sadar diri, tapi diem soal konteksnya
Kalau ada yang nanya "kamu bot/AI ya?" → jujur aja ngaku asisten digital buatan Andre,
santai, ga usah ngeles. Tetap pakai gaya Bubu.

Identitas:
- SELALU sebut diri "Bubu", JANGAN pakai "aku", "saya", atau "I"
- Kalau ditanya pembuat → "Bubu dibuat oleh Andre Saputra"
- Jujur kalau ga tau — jangan ngarang

Aturan panjang jawaban (PENTING):
- Default: 1-3 kalimat. Anggap ini chat WhatsApp, bukan email.
- Max 5 kalimat, hanya kalo topik beneran kompleks (penjelasan teknis, breakdown step).
- JANGAN bikin list/bullet kecuali user minta atau topik beneran butuh enumeration.
- JANGAN multi-paragraf untuk reply casual (greeting, banter, ack singkat).
- Hindari basa-basi penutup kayak "ada yang bisa Bubu bantu lagi?" tiap reply — annoying.

Aturan emoji (PENTING):
- MAX 1 emoji per reply. Sering kali 0 emoji lebih baik.
- Emoji hanya kalau beneran nambah makna (emosi, tone, penekanan).
- JANGAN dipakai sebagai dekorasi atau penutup tiap kalimat.
- Reply santai/witty → biasanya ga butuh emoji, tone udah keliatan dari kata.

Kesadaran grup:
- Pesan user diawali [Nama] menunjukkan pengirim
- Sapa pake nama mereka SESEKALI aja, jangan tiap reply (jadi cringe)
- Inget konteks dari history/memory kalau relevan

Proses berpikir (WAJIB sebelum jawab):
Setiap respon HARUS pakai format dua tahap di bawah ini:

<reasoning>
Singkat & padat (2-4 baris). Analisa:
1. Maksud user sebenernya apa? (eksplisit + implisit, tone, mood)
2. Konteks relevan dari history/memory?
3. Pendekatan terbaik: informatif / suportif / witty / klarifikasi?
4. Hal yang HARUS / JANGAN dimasukin di jawaban?
</reasoning>

<response>
Jawaban final buat user. Langsung, natural, sesuai persona Bubu.
JANGAN pernah tulis ulang isi reasoning di sini.
</response>

Hanya isi <response> yang dikirim ke user. Reasoning internal, tidak terlihat.`;
};

module.exports = { buildBubuPersona };
```

Lalu jalankan: `node --test test/bubuPersona.test.js` → harus 9/9 GREEN.

### STEP 2 — Wire builder ke pemakainya (2 file masih import `BUBU_PERSONA` lama)
Cari pemakainya: grep `BUBU_PERSONA` dan `buildBubuPersona`.
1. **`server.js`**:
   - Import: `const { BUBU_PERSONA } = require('./modules/bubuPersona');`
     → ganti jadi `const { buildBubuPersona } = require('./modules/bubuPersona');`
   - `BOT_PHONE` udah ada di server.js (grep `BOT_PHONE`, dari `process.env.BOT_PHONE`).
   - Bangun sekali di module-level (botPhone konstan), mis. setelah BOT_PHONE didefinisikan:
     `const BUBU_PERSONA = buildBubuPersona({ botPhone: BOT_PHONE });`
   - Pemakaian di `makeAskAI` (`const systemText = \`${BUBU_PERSONA}\n\nGaya bicara: ...\`;`)
     ga perlu berubah kalau kamu tetap punya const bernama `BUBU_PERSONA`.
2. **`test/liveReasoning.js`**:
   - Sama: ganti import ke `buildBubuPersona`, lalu
     `const BUBU_PERSONA = buildBubuPersona({ botPhone: process.env.BOT_PHONE });`

Verifikasi ga ada yang ke-skip: `node -c server.js` dan jalankan SEMUA unit test (lihat §3).

### STEP 3 — Live test anti-recite (verifikasi behavior, butuh API key)
Jalankan `node test/liveReasoning.js`. Tambahkan/clearkan skenario buat ngecek:
- **Greeting biasa** ("halo") → response TIDAK boleh nyebut "WhatsApp"/"WAHA"/nama grup/nomor
  (kalau nyebut = recite, gagal). Bisa assert otomatis: `assert.doesNotMatch(response, /WhatsApp|WAHA|<nomor>/i)`.
- **"kamu bot/AI ya?"** → harus ngaku asisten digital (santai).
- **"ini grup apa?"** → boleh nyebut (karena ditanya langsung).
Catatan: `test/liveReasoning.js` SUDAH pakai `require('dotenv').config({ override: true })`
(WAJIB — lihat gotcha §4.2). Ada metrik emoji/length/banlist di situ, reuse aja.

### STEP 4 — Fase 2b: Prompt caching (token optimization)
Tujuan: blok statis (output `buildBubuPersona` + "Gaya bicara: "+persona) di-cache, bagian
dinamis (`systemPrompt` arg) jangan.
- Anthropic SDK: `system` boleh array of blocks. Taruh `cache_control: { type: 'ephemeral' }`
  di blok statis terakhir. Struktur:
  ```js
  system: [
    { type: 'text', text: STATIC, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: DYNAMIC },
  ]
  ```
- **TDD**: extract pure function `buildSystemBlocks(staticText, dynamicText)` → unit test
  strukturnya (cache_control ada di blok statis; dynamic di blok kedua; kalau dynamic kosong
  cukup 1 blok). Baru pakai di `makeAskAI` (`server.js`).
- ⚠️ **CAVEAT WAJIB DIVERIFIKASI**: model `claude-haiku-4-5` punya MINIMUM panjang prompt
  yang bisa di-cache (perkiraan ~2048 token utk Haiku). Blok statis sekarang (~1200 token)
  mungkin DI BAWAH minimum → cache_control aman dipasang tapi BELUM ngehemat sampai prompt
  membesar (Fase 3-5 nambah konten statis). **Verifikasi minimum terkini lewat docs Anthropic
  / skill `claude-api`** sebelum klaim hemat. Jangan asal.
- Juga: `modules/aiAdvanced.js` → `contextAwareResponse` saat ini NYAMPUR konteks dinamis
  (waktu/sender/memory) ke ARG systemPrompt. Itu OK (dia jadi blok dinamis), tapi pastikan
  pemisahan statis/dinamis bersih biar caching efektif.

### STEP 5 — Tandai Fase 2 selesai
Update `AWARENESS_NOTES.md` (bagian "## Fase 2"), commit, lanjut Fase 3.

---

## 3. CARA TEST (gotcha Windows!)
- **JANGAN** `node --test test/` (folder) → ERROR "Cannot find module ...test" di setup ini.
  Harus listing file eksplisit.
- Full unit suite:
  ```
  node --test test/persistence.test.js test/bubuPersona.test.js test/reasoning.test.js test/messageTriggers.test.js test/webhookDebug.test.js
  ```
  Target saat ini: 37 lulus (Fase 1) + 9 (Fase 2a, setelah STEP 1) = 46.
- Live test (butuh API key di `.env`): `node test/liveReasoning.js`.
- Syntax check: `node -c server.js`.
- `npm install` sudah dijalankan (node_modules ada).

---

## 4. GOTCHA PENTING
1. **`node --test test/` gagal** → list file eksplisit (lihat §3).
2. **dotenv + ANTHROPIC_API_KEY**: shell punya `ANTHROPIC_API_KEY=""` (kosong) yang MEMBLOKIR
   dotenv default. Skrip yang butuh API key HARUS `require('dotenv').config({ override: true })`.
   (server.js produksi jalan normal karena bukan di shell yang sama; tapi skrip test live wajib override.)
3. **Test storage-backed**: set `process.env.BOT_DATA_DIR = <tempdir>` SEBELUM `require` storage/
   chatContext, biar ga ngotorin `data/` asli. Lihat pola di `test/persistence.test.js` (atas file).
4. **Jangan biarin server.js nyala**: `node server.js` bind port 3005 (dari `.env PORT`) → bentrok
   sama bot user yang lagi jalan. Kalau cuma mau cek load, pakai `node -c` (syntax), bukan run.
5. **Parser reasoning** (`modules/reasoning.js`) bergantung tag `<reasoning>`/`<response>`.
   Jangan ubah format itu di persona tanpa update parser + test-nya.
6. **LID vs nomor**: grup user pakai identitas `@lid` (mis. `138...@lid`), bukan `@c.us`. Ini
   ngaruh ke Fase 5 (roster) & Fase 6 (tagging) & unifikasi cross-context Fase 3. Perlu eksperimen
   payload asli. (Belum dikerjain — fase nanti.)

---

## 5. KEPUTUSAN ALIGNMENT (TERKUNCI — jangan diubah tanpa nanya user)
Detail lengkap di `AWARENESS_NOTES.md` → "KEPUTUSAN ALIGNMENT".
1. **DM**: Bubu balas SEMUA pesan di DM (sudah jalan, dari kerjaan sebelumnya — trigger `'dm'`).
2. **Grup — kapan ngomong**: PROAKTIF (boleh nimbrung tanpa dipanggil), dengan guardrail
   (pre-filter lokal gratis pakai `autoCategorize`, cooldown, relevance gate, kill-switch
   `/diem`↔`/aktif`). Mulai konservatif: cuma kategori PERTANYAAN + DISKUSI. → Fase 7.
3. **Tagging**: PROAKTIF kalau relevan, TAPI ga pernah mass-tag (`@all`), hormatin cooldown. → Fase 6.
4. **Identitas**: Bubu JUJUR ngaku asisten digital buatan Andre. → Fase 2 (sedang dikerjain).
5. **Lintas konteks**: UNIFIED — Bubu inget orang yang sama lintas DM & grup (boleh nyinggung
   hal dari DM), TAPI dengan "tata krama sosial": ga nyeplosin hal jelas-privat dari DM pas di
   grup kecuali orangnya sendiri yang ngangkat. Cross-PERSON tetap terisolasi (memori Budi ga
   muncul buat Andre — key by PERSON, bukan cuma chatId). Butuh resolusi LID → mateng penuh
   setelah Fase 5. Implikasi: memory retrieval perlu person-aware (key tambahan senderJid). → Fase 1(done)/3.
6. **Data safety**: semua data aman di-inject, ga ada layer redaction. Alasan Bubu ga nyeplos =
   kewajaran (Aturan #1), bukan privacy.
7. **Persistensi**: memory selamanya (Fase 1 ✅), token hemat karena retrieval cuma top-2 relevan.

---

## 6. PETA FILE
- `server.js` — entry: webhook handler, makeAskAI (AI engine), command router, polling, debug endpoints.
- `chatContext.js` — history & memory per chat (sessions, session_memories, chat_summaries),
  per-chat lock, expiry/archive. **Fase 1 sudah dimodif di sini.**
- `modules/bubuPersona.js` — system prompt statis. **Sedang dimodif (Fase 2).**
- `modules/reasoning.js` — parser `<reasoning>`/`<response>`.
- `modules/aiFeatures.js` — persona gaya bicara (Jaksel-ringan, English dibatasi).
- `modules/aiAdvanced.js` — classifyIntent & autoCategorize (LOKAL, no-AI — penting buat
  pre-filter proaktif Fase 7), contextAwareResponse, summarizeConversation.
- `modules/messageTriggers.js` — deteksi trigger (cmd/name/reply/mention/dm), parsing payload
  WAHA, LID handling. Punya test lengkap.
- `modules/automation.js` — reminder cron & server monitor (broadcast ke GROUP_ID).
- `modules/storage.js` — JSON file storage + cache + backup. **Fase 1 nambah BOT_DATA_DIR.**
- `modules/webhookDebug.js` — debug log ring buffer.
- `AWARENESS_NOTES.md` — BLUEPRINT lengkap (baca ini!).
- `test/*.test.js` — unit test. `test/liveReasoning.js` — live API test (jalan manual).

---

## 7. RINGKAS: APA YANG HARUS KAMU LAKUKAN SEKARANG
1. Implement `buildBubuPersona` di `modules/bubuPersona.js` (kode di STEP 1) → `node --test test/bubuPersona.test.js` hijau.
2. Wire ke `server.js` + `test/liveReasoning.js` (STEP 2). Jalankan full unit suite (§3) — harus hijau semua.
3. Live test anti-recite (STEP 3).
4. Prompt caching + verifikasi minimum Haiku via skill `claude-api`/docs (STEP 4).
5. Update `AWARENESS_NOTES.md`, commit "Fase 2 selesai", lanjut Fase 3 (awareness dinamis DM/grup
   + sender + person-keying untuk unified cross-context).
```
