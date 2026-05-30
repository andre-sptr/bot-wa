# Bubu Awareness — Design Notes

> Fitur: bikin Bubu "sadar konteks" seperti manusia yang bales chat di WhatsApp
> (DM/grup, siapa lawan bicara, posisinya jalan via nomor WA lewat WAHA) —
> **tanpa** membacakan konteks itu ke user.
>
> Status: Fase 3 selesai (awareness dinamis DM/grup + sender).
> Reply-bubble awareness lanjut di Fase 4.

---

## POIN 1 — Awareness, bukan Announcement ✅ dibahas

### Prinsip inti ⭐ ATURAN #1 (paling penting dari seluruh fitur)
**Context = lensa, BUKAN naskah.** Bubu melihat *lewat* konteksnya, tapi tidak
pernah *membacakan*-nya.

- ❌ SALAH: "Halo Andre, saya Bubu, kita lagi di grup Draft, ada yang bisa dibantu?"
- ✅ BENAR: "Eh Andre, kenapa?" (sadar siapa & dimana, tapi cuma keliatan dari *cara* balas)

**Patokan kanonik (dari user):** Manusia TAU dia lagi bales di grup mana, tapi
TIDAK menyebut nama grupnya kalau tidak ditanya.

Aturan operasional:
- Bubu PUNYA konteks (grup apa, siapa lawan bicara, jalan via WA) → cuma buat
  ngebentuk *cara* jawab (tone, audiens, sapaan).
- Bubu SEBUT detail konteks HANYA kalau ditanya langsung
  (mis. "ini grup apa?" → baru jawab). Selain itu: tau aja, diem.
- Nyebut nama/tempat/status HANYA kalau relevan sama obrolan — bukan pembuka rutin.

### Kenapa AI suka "recite" (akar masalah)
Context yang di-inject ke prompt kebaca model sebagai "info baru yang berguna"
→ naluri helpful-nya bilang "sampaikan ke user". Dua jebakan di kasus kita:
1. **Cara nulis context** — harus di-framing sebagai *"yang kamu TAU (background),
   BUKAN yang kamu omongin"* + larangan eksplisit.
2. **Reasoning block bisa bocor** — `<reasoning>` boleh pakai konteks, tapi butuh
   aturan keras: hasil `<response>` jangan parroting konteks.

### Rencana teknik (pas implement)
- Framing injected context sebagai background knowledge, bukan fakta untuk di-acknowledge
- Negative instruction eksplisit ("jangan umumkan konteks ini")
- 1-2 contoh BENAR/SALAH (pola few-shot yang terbukti ampuh pas berantas Jaksel)
- Pisahkan: context statis (Bubu jalan via WAHA, nomornya X) → system prompt sekali;
  context dinamis (DM/grup, sender siapa, reply ke apa) → inject per-pesan di `makeAskAI`

---

## Sub-topik yang ke-cover di Poin 1

### A. Sadar siapa yang ngomong ✅ SUDAH JALAN
- `senderName` di-extract dari `notifyName` → `server.js` (`processIncomingPayload`)
- Di-inject ke AI sebagai prefix `[Nama] pesan` → `makeAskAI` (`server.js`)
- History juga simpan sender per baris → Bubu lihat `[Andre] ...` / `[Rina] ...`
- ⚠️ Catatan: `notifyName` = nama display yang di-set user sendiri di WA
  (bukan nama kontak di HP kita). Kalau kosong → fallback ke nomor/JID.

### B. Sadar bubble mana yang di-reply ⚠️ DATA ADA, BELUM DI-WIRE
- Status sekarang:
  - Bubu tau "ini pesan me-reply sesuatu" → ✅ (dipakai buat trigger `'reply'`)
  - Bubu tau **isi** bubble yang di-reply → ❌ belum di-inject ke AI
- Payload WAHA **bawa** isi quoted msg (`replyTo.body` / `_data.quotedMsg.body`),
  tapi `makeAskAI` cuma kirim pesan baru + history. Quoted content ga pernah dipakai.
- Dampak: reply ke bubble lama (>12 pesan / >6 jam expire) → Bubu buta.
  Reply ke pesan orang lain sambil sebut Bubu → Bubu ga lihat konteks bubble itu.
- **TODO**: extract `quotedMsg.body` + author bubble → inject ke konteks AI.
  Target format: `[Andre] (me-reply pesan Bubu: "...") → "itu udah naik belum?"`

### C. Sadar anggota grup + bisa nge-tag 🔬 FEASIBLE (riset LID dulu)
- **Endpoint daftar member**: `GET /api/{session}/groups/{groupId}/participants/v2`
  → balik `id` (mis. `628...@c.us`) + `role` (participant/admin/superadmin/left)
- **Tagging**: `POST /api/sendText` terima array `mentions`. Format DOBEL & wajib dua-duanya:
  ```json
  {
    "session": "BotWA",
    "chatId": "...@g.us",
    "text": "Eh @628123456789 cek dong",
    "mentions": ["628123456789@c.us"]
  }
  ```
  Bonus: `"mentions": ["all"]` → tag semua orang.
- **Cache strategy** (sesuai keinginan: ambil sekali, simpan):
  - Fetch participants → simpan via `modules/storage.js` (`storage.save('group_members_<id>', ...)`)
  - Bubu baca dari cache, ga hit WAHA terus
  - Refresh: pas startup + command manual (mis. `/refresh-members`) atau TTL
- ⚠️ **GOTCHA — grup pakai LID**: webhook grup kita munculin ID `@lid`
  (mis. `138384550936741@lid`), bukan `@c.us`. WAHA warning: "Check Contacts - Lids
  if you see @lid in participants list". Kemungkinan butuh resolve `@lid` → nomor asli,
  atau cari format mention LID yang bener. Bukan blocker — butuh 1x eksperimen
  sama payload asli grup pas implement.

---

## Checklist implementasi (dari Poin 1)
- [x] Inject context statis (via WAHA, identitas Bubu) ke system prompt — framing "tau, bukan umumin"
- [x] Inject context dinamis (DM vs grup, senderName) sebagai background, bukan announcement
- [x] Negative instruction + contoh BENAR/SALAH biar ga recite
- [x] Aturan: reasoning boleh pakai konteks, response jangan parroting
- [ ] Wire isi quoted/reply message ke konteks AI (sub-topik B)
- [ ] Endpoint ambil + cache participants grup (sub-topik C)
- [ ] Riset & pecahkan LID → nomor untuk tagging (sub-topik C)
- [ ] Implement tagging via mentions array di sendWA

---

## POIN 2 — Keamanan data yang di-inject ✅ dibahas

### Keputusan
**Semua data aman di-inject apa adanya.** Tidak ada yang benar-benar privat:
nomor Bubu = milik sendiri; nama grup & identitas member = sudah saling terlihat
di grup. → **Tidak perlu layer redaction/sensor.** (menghilangkan 1 kerumitan)

### Reframe penting (nyambung ke Poin 1)
"Aman di-inject" ≠ "bebas dibocorkan". Alasan Bubu tidak menyeplos nomor/nama grup
**bukan privacy** (datanya aman), tapi **kewajaran** (Poin 1). Jadi aturan anti-recite
Poin 1 sudah otomatis menutup ini — tidak butuh rule tambahan.

### Batas yang tetap dijaga: scoping per-chat ✅ TERVERIFIKASI
- Context yang di-inject ke satu pesan = konteks chat itu saja (DM ≠ grup, DM ≠ DM lain)
- **Sudah ter-handle** oleh isolasi per-`chatId` di `chatContext.js`. Bukti kode:
  - History kepisah per chat → `sessions[chatId]` (chatContext.js ~180)
  - Memory difilter ketat pas dibaca → `memories.filter(m => m.chatId === chatId)`
    (chatContext.js ~119) — ingatan DM Andre mustahil nyangkut ke DM Budi/grup
  - Tiap memory di-stamp `chatId` pas disimpan (chatContext.js ~91)
- Kesimpulan: DM-A, DM-B, dan grup = 3 dunia terpisah. Tidak ada jalur bocor.
- Aturan: jangan rusak boundary ini pas implement.

### Behavior rule untuk tagging (bukan privacy)
- Tag HANYA kalau relevan / diminta. Jangan mass-tag (`@all`) sembarangan.
- Soal "jangan bikin Bubu annoying", bukan soal bocor data.

---

## POIN 3 — Persistensi context (forever) + hemat token ✅ dibahas

### Keinginan user
Context tetap ada **selamanya**, TIDAK auto-hapus. Hanya terhapus kalau owner
sendiri buka VPS & hapus isi folder `data/`. Tetap hemat token (boros sedikit OK,
asal tidak boros banget).

### Insight kunci: Storage ≠ Injection
- **Storage** (disk `data/`) = ~gratis. Token cost = NOL. Simpan 10rb memory ga ngaruh.
- **Injection** (yang masuk prompt tiap call) = ini yang makan token. Hanya ini dijaga.
- Kesimpulan: simpan semua selamanya (murah), inject cuma slice relevan (hemat). Bisa dua-duanya.

### PENTING: Expiry ≠ penghapus memory (jangan disamakan)
Expiry BUKAN "lupa". Pas session expired (chatContext.js:164), dia:
1. `archiveSession` → SIMPAN dulu jadi memory + summary (kompres)
2. baru reset history aktif jadi kosong
Jadi percakapan ga ilang — dikompres jadi recall jangka panjang. Expiry justru
salah satu momen memory DIBUAT.

Analogi otak manusia:
- Working memory (atensi aktif sekarang) → window aktif, di-reset pas expiry. SEHAT.
- Long-term memory (inget pernah ngobrolin X) → memory store → INI yang dibikin selamanya.

### Kondisi SEKARANG: yang BENERAN ngehapus recall jangka panjang (3 cap + backup)
1. Cap total → `MAX_MEMORIES_TOTAL = 200`, lebih = dihapus (chatContext.js:110) ← CABUT
2. Cap per-chat → `MAX_MEMORIES_PER_CHAT = 50` (chatContext.js:104) ← CABUT
3. Cap summary → 10 terakhir, sisanya `.shift()` (chatContext.js:159) ← CABUT
4. Backup cuma 7 hari (storage.js:58, `files.slice(7)` di-unlink) ← pertimbangkan perpanjang

Expiry (`AUTO_EXPIRE_HOURS = 6`, chatContext.js:4) → JANGAN dicabut. Penjaga token +
freshness + pemicu arsip. Cuma di-TUNE: 6 jam → 24 jam (continuity harian verbatim,
tetap aman karena window dibatasi 12 pasang di chatContext.js:205).

### Yang bikin tetap hemat: retrieval udah pinter ✅
- `getRelevantMemory` (chatContext.js:117) udah: filter per-chat → skor topic overlap
  → ambil **top 2** doang. RAG sederhana.
- Punya 10rb memory pun, yang ke-inject cuma 2 yang relevan → **token flat**.
- Estimasi: disk 10rb memory ≈ 3 MB (sepele); token/call ~konstan selamanya.

### Trade-off (KEPUTUSAN: pilih A)
- **(A) Bubu INGAT selamanya** via summary + retrieval relevan → murah, skalabel. ✅ DIPILIH.
  Detail verbatim lama jadi summary, tapi Bubu tetap "inget pernah ngobrolin X".
- (B) Replay SEMUA pesan mentah selamanya → token naik linear → "boros banget" → DITOLAK.
- Opsional "boros dikit yang aman": naikin expiry 6→24 jam biar continuity harian verbatim.

### TODO implementasi (Poin 3)
- [ ] Cabut 3 cap memory (MAX_MEMORIES_TOTAL, MAX_MEMORIES_PER_CHAT, summary cap)
- [ ] TUNE expiry 6 → 24 jam (JANGAN dicabut — cuma dinaikin)
- [ ] Pertimbangkan perpanjang retensi backup (storage.js:58)
- [ ] Pastikan injection tetap bounded: history aktif (≤12 pasang) + top-K memory relevan
- [ ] (Skala jauh) kalau memory sampai puluhan ribu: pertimbangkan retrieval lebih efisien
      (sekarang O(n) scan tiap pesan — masih cepat utk ribuan, fine utk bot personal)

---

## POIN 4 — Arsitektur injection: Statis vs Dinamis ✅ dibahas

### Konsep
- **STATIS** = info yang TIDAK pernah berubah antar pesan/chat (identitas Bubu, jalan
  via WAHA, nomor WA, pembuat, persona, aturan kewajaran). → Ditulis SEKALI di system prompt.
- **DINAMIS** = info yang BERUBAH tiap pesan masuk (DM vs grup, siapa sender, lagi
  reply bubble apa). → Dihitung & di-inject FRESH per-pesan di `makeAskAI`.

### Kenapa dipisah
1. **Correctness**: info dinamis kalau dipaku di system prompt → salah. Mis. hardcode
   "kamu di grup" → pas DM, Bubu ngira di grup. Dinamis WAJIB per-pesan.
2. **Token (nyambung Poin 3)**: bagian statis yang konstan bisa di-cache (prompt caching)
   → diskon. Campur dinamis ke situ → cache jebol tiap pesan → bayar penuh terus.

### Pemetaan ke kode
| Jenis | Naro di | Lokasi |
|---|---|---|
| Statis (identitas, persona, aturan) | system prompt (sekali) | `BUBU_PERSONA` (modules/bubuPersona.js) |
| Dinamis (DM/grup, sender, reply) | per-pesan | `makeAskAI` (server.js:120) |

### TODO implementasi (Poin 4)
- [ ] Tambah info STATIS ke BUBU_PERSONA: "kamu bales chat di WhatsApp via WAHA,
      nomormu 628xxx, dibuat Andre Saputra" — dengan framing Aturan #1 (tau, bukan umumin)
- [ ] Tambah info DINAMIS di makeAskAI: tipe chat (DM/grup), [nama grup kalau grup],
      sender (udah ada), isi reply (dari sub-topik B Poin 1)
- [ ] (Token win opsional) aktifkan prompt caching di blok statis — sekarang BELUM dipakai;
      catatan: `contextAwareResponse` skrg malah nyampur context dinamis (waktu/sender/memory)
      ke arg systemPrompt → perlu dirapikan biar pemisahan statis/dinamis bersih

---

## POIN 5 — Behavior: proaktif (tagging + ngomong) ✅ dibahas

### Keputusan user
- **Tagging: PROAKTIF kalau relevan** — Bubu boleh tag orang sendiri tanpa diminta.
- **Ngomong di grup: LEBIH PROAKTIF** — Bubu boleh nimbrung tanpa dipanggil.
- (DM tetap: respon semua pesan — ga berubah. Proaktif ini konsep khusus grup.)

### Implikasi penting (arsitektur + token)
- Sekarang: pesan ga-trigger → DROP, ga ada LLM call (murah).
- Proaktif: tiap pesan grup harus DIEVALUASI "perlu nimbrung ga?" → kalau naif,
  LLM call tiap pesan → BISA boros banget + annoying. Harus di-guard.

### Guardrail (biar proaktif ≠ boros banget / berisik) — nyambung constraint user
1. **Pre-filter LOKAL gratis** (reuse autoCategorize/classifyIntent di aiAdvanced.js):
   cuma kandidat (PERTANYAAN/DISKUSI/topik relevan) yang lanjut ke LLM.
   Pesan receh ("oke", "wkwk", emoji) ga pernah sampe LLM.
2. **Cooldown**: max ~1x nimbrung per beberapa menit per grup (anti-spam).
3. **Relevance gate**: nimbrung cuma kalau ada value; ragu → diem (sejalan Aturan #1).
4. **Kill-switch**: command matiin/nyalain mode proaktif (mis. /diem /chill ↔ /aktif).
5. **Tagging proaktif**: cuma kalau relevan, ga pernah mass-tag (@all), hormatin cooldown.

### Catatan
- Proaktif TETAP lebih mahal dari triggered-only (inheren). Guardrail bikin jadi
  "boros dikit terkontrol".
- Agresivitas: MULAI KONSERVATIF (pertanyaan/diskusi + cooldown panjang), tune live
  kayak persona. Longgarin kalau kerasa kurang aktif.

### TODO implementasi (Poin 5)
- [ ] Ubah flow: pesan grup non-trigger → pre-filter lokal → (kandidat) → gate proaktif
- [ ] Cooldown per-grup buat pesan proaktif (state in-memory, mirip rateLimitMap)
- [ ] Gate relevansi (bagian dari reasoning Bubu: "worth nimbrung? kalau ngga, diem")
- [ ] Command kill-switch + state on/off per-grup (persist via storage)
- [ ] Tagging proaktif: logic relevan + larangan @all + cooldown

---

---

# IMPLEMENTATION ROADMAP (urutan kerja)

Prinsip: tiap fase berdiri sendiri, bisa di-test & commit kecil. Urut by dependency +
risiko (yang besar/berisiko di belakang). Mulai konservatif, tune live.

## KEPUTUSAN ALIGNMENT (terkunci)
1. **Identitas**: Bubu JUJUR ngaku asisten digital buatan Andre (transparan, tetap santai).
   → Fase 2. Sesuai persona sekarang.
2. **Lintas konteks**: UNIFIED — Bubu inget orang yang sama lintas DM & grup, boleh
   nyinggung hal dari DM. → Fase 1 & 3.
   - REFINEMENT (tata krama sosial, sejalan Aturan #1): Bubu inget semua, TAPI ga
     nyeplosin hal jelas-privat dari DM pas di grup, kecuali orangnya sendiri yang ngangkat.
     Temen yang sopan, bukan ember. [disetujui user 2026-05-30]
   - Cross-PERSON tetap aman: memori Budi ga pernah muncul buat Andre (key by PERSON,
     bukan cuma chatId). Isolasi antar-orang yang dulu diverifikasi → TETAP berlaku.
   - Dependency teknis: nyambungin grup-Andre (@lid) = DM-Andre (@c.us) butuh resolusi
     LID → unifikasi DM↔grup penuh baru mateng SETELAH Fase 5. Implikasi arsitektur:
     memory retrieval perlu person-aware (key tambahan senderJid), bukan cuma chatId.
3. **Proaktif**: pertimbangin nimbrung di PERTANYAAN + DISKUSI (pakai autoCategorize yang
   udah ada). → Fase 7.

## Fase 1 — Persistensi "forever" (backend, isolated, low-risk) ✅ SELESAI
- [x] Cabut 3 cap memory (MAX_MEMORIES_TOTAL, MAX_MEMORIES_PER_CHAT, summary cap) +
      hapus konstanta yang jadi unused
- [x] Tune expiry 6→24 jam (konstanta AUTO_EXPIRE_HOURS). Logika archive-then-reset utuh.
- [x] storage.js: dukung BOT_DATA_DIR (override data dir) buat test isolation
- [x] Export saveSessionMemory + archiveSession (buat test + Fase 3 person-keying)
- [x] 5 unit test TDD di test/persistence.test.js (semua RED→GREEN), 37/37 suite hijau
- DEFERRED (opsional): backup rolling 7 hari (storage.js:58) DIBIARKAN — file data utama
  yang jadi source of truth ga pernah auto-hapus, backup cuma redundansi. Cukup.
- CATATAN: memory sekarang numpuk selamanya. Token tetap aman karena getRelevantMemory
  cuma inject top-2 relevan. Person-keying (unified cross-context) menyusul di Fase 3.
- ⚙️ Dipengaruhi pertanyaan: cross-context (scoping memory) → diimplement Fase 3

## Fase 2 — Identitas statis + anti-recite (jantung visi) ✅ SELESAI
- [x] `modules/bubuPersona.js`: `buildBubuPersona({ botPhone })` jadi single source of truth
  persona statis. Prompt sekarang inject konteks WhatsApp/WAHA + nomor bot, dengan Aturan #1:
  konteks adalah lensa, bukan naskah.
- [x] `server.js` dan `test/liveReasoning.js`: pakai builder supaya `BOT_PHONE` dari env masuk
  ke persona statis.
- [x] Prompt caching: `modules/systemBlocks.js` memisahkan blok statis cached dan blok dinamis
  uncached. `cache_control: { type: "ephemeral" }` ditempel di akhir blok statis.
- [x] Live anti-recite test: greeting tidak menyebut WhatsApp/WAHA/nomor; pertanyaan bot/AI
  dijawab jujur sebagai asisten digital; pertanyaan konteks grup boleh menyebut nama grup.
- Catatan cache: docs Anthropic per 2026-05-30 menyebut minimum cacheable prompt untuk Claude
  Haiku 4.5 adalah 4.096 token. Live test saat ini menunjukkan input sekitar 1.861 token,
  jadi struktur caching sudah benar, tapi belum boleh diklaim menghemat sampai prompt statis
  melewati minimum atau `usage.cache_creation_input_tokens/cache_read_input_tokens` > 0.
- Verifikasi: `node -c server.js`; `node --test test/persistence.test.js test/bubuPersona.test.js
  test/systemBlocks.test.js test/reasoning.test.js test/messageTriggers.test.js
  test/webhookDebug.test.js` = 49/49 pass; `node test/liveReasoning.js` = 7 skenario,
  policy fails 0.
- Dependency: none (fondasi Fase 3-4).
- ⚙️ Dipengaruhi pertanyaan: identitas (ngaku AI atau human-like)

## Fase 3 — Awareness dinamis: DM/grup + sender ✅ SELESAI
- [x] `modules/aiAdvanced.js`: tambah `buildDynamicAwarenessContext` untuk blok konteks
  dinamis yang eksplisit dilabeli LATAR BELAKANG, bukan announcement.
- [x] `modules/aiAdvanced.js`: tambah `buildRuntimeChatContext` untuk derive `chatType`
  (`dm`/`group`), `chatName` best-effort, `chatId`, dan `senderJid` dari payload runtime.
- [x] `server.js`: `processIncomingPayload` sekarang membangun chat context sekali lalu
  meneruskannya ke `handleNaturalLanguage` → `contextAwareResponse`.
- [x] `contextAwareResponse`: tetap backward-compatible dengan signature lama, tapi mendukung
  object options `{ senderName, memoryContext, chatContext }` agar context dinamis bersih
  masuk ke blok uncached.
- [x] Live test: tambah skenario DM dan grup casual yang memastikan context dinamis tidak
  dibacakan; direct group context tetap boleh menyebut nama grup ketika ditanya langsung.
- [x] Observability cache: `test/liveReasoning.js` sekarang menampilkan
  `cache_creation_input_tokens` dan `cache_read_input_tokens`. Verifikasi 2026-05-30 masih
  `create=0 read=0`, sesuai catatan Fase 2 bahwa prompt Haiku 4.5 belum melewati threshold.
- Verifikasi: `node -c server.js`; `node --test test/persistence.test.js test/bubuPersona.test.js
  test/systemBlocks.test.js test/awarenessContext.test.js test/reasoning.test.js
  test/messageTriggers.test.js test/webhookDebug.test.js` = 56/56 pass; `node test/liveReasoning.js`
  = 9 skenario, banlist hits 0, policy fails 0.
- Deferred: isi quoted/reply bubble tetap Fase 4; fetch/cache nama grup resmi dari WAHA tetap
  Fase 5 kalau payload runtime tidak membawa nama grup.
- Dependency: Fase 2.

## Fase 4 — Reply-bubble awareness 🟡
- Extract quotedMsg.body + author bubble → inject ke konteks AI.
- Test: reply pesan Bubu yang lama → Bubu nyambung (bukan buta).
- Dependency: Fase 3.

## Fase 5 — Roster grup: fetch + cache + LID (research-heavy) 🟠
- Endpoint GET participants/v2 + nama grup. Cache via storage.js. Pecahkan LID→nomor.
- Test: fetch grup asli, inspect cache, verifikasi format LID buat tagging.
- Dependency: none teknis, tapi enrich Fase 3 (nama anggota) & WAJIB buat Fase 6.

## Fase 6 — Tagging beneran 🟠
- sendWA pakai mentions array (format dobel: @nomor di teks + nomor@c.us di array).
- Logic tag-when-relevant (proaktif), larangan @all, hormatin cooldown.
- Test: Bubu tag seseorang → notif beneran nyala (bukan teks doang).
- Dependency: Fase 5.

## Fase 7 — Proaktif + guardrail (behavior terbesar, paling berisiko) 🔴
- Flow non-trigger → pre-filter lokal (autoCategorize) → gate relevansi → cooldown → respon/tag.
- Kill-switch /diem ↔ /aktif (state per-grup, persist via storage).
- Test: simulasi grup rame — Bubu selektif, cooldown jalan, kill-switch jalan.
- Dependency: Fase 2-5 (awareness & roster mateng dulu biar respon proaktif berkualitas).
- ⚙️ Dipengaruhi pertanyaan: proactive calibration (kategori apa yang dipertimbangin)

---
_Catatan: urutan fleksibel. Fase 1 bisa duluan kapan aja (isolated). Fase 2 = inti visi.
Fase 7 sengaja terakhir karena paling ngubah behavior & biaya._
