# HANDOVER — Bubu Awareness Feature

> Untuk agent penerus di Antigravity / Opus. Dokumen ini self-contained karena
> agent penerus tidak punya konteks chat Codex sebelumnya.
>
> Project: WhatsApp bot "Bubu" di `D:\Website\bot-projects\bot_wa`.
> Stack: Node.js + Express + WAHA (WhatsApp HTTP API) + Anthropic SDK.
> Model default live test/server: `claude-haiku-4-5-20251001`.
> Bahasa komunikasi user: Indonesia santai.

---

## 0. Instruksi Kerja Penting

- **TDD wajib**: tulis test dulu, lihat RED, baru implement GREEN, lalu refactor.
- **Grounding dulu**: baca kode terkait sebelum mengubah, terutama payload WAHA dan Anthropic API.
- **Commit kecil per fase**: repo sejauh ini commit per fase.
- **Update `AWARENESS_NOTES.md` setiap selesai fase**.
- **Jangan jalankan `node server.js` untuk sekadar cek load** karena bisa bind port bot aktif. Pakai `node -c server.js`.
- Di Codex workspace ini ada instruksi AGENTS: shell command diprefix `rtk`. Kalau Antigravity tidak punya `rtk`, pakai command native ekuivalen.

---

## 1. Status Repo Saat Handover

Branch: `main`

Commit terakhir:

```text
3aa412b Complete Bubu awareness phase 4
dc6dc59 Complete Bubu awareness phase 3
179cc16 Complete Bubu awareness phase 2
1d154da Add handover doc + Fase 2a RED test (WIP)
```

Status sebelum file handover ini dibuat: working tree clean.

Fase selesai:

- Fase 1 — Persistensi "forever": selesai.
- Fase 2 — Identitas statis + anti-recite + prompt caching blocks: selesai.
- Fase 3 — Awareness dinamis DM/grup + sender: selesai.
- Fase 4 — Reply-bubble awareness: selesai.

Yang harus dilanjutkan:

- **Fase 5 — Roster grup: fetch + cache participants + riset LID.**

---

## 2. Keputusan Produk yang Sudah Terkunci

1. **DM**: Bubu membalas semua pesan DM.
2. **Grup**: sekarang masih trigger-based; nanti Fase 7 akan dibuat lebih proaktif dengan guardrail.
3. **Identitas**: Bubu jujur kalau ditanya bot/AI, sebagai asisten digital buatan Andre Saputra.
4. **Anti-recite**: context adalah lensa, bukan naskah. Bubu tahu DM/grup/sender/nomor/quoted bubble, tapi tidak membacakan konteks kecuali user bertanya langsung.
5. **Tagging**: nanti boleh proaktif kalau relevan, tapi tidak mass-tag `@all` dan harus hormati cooldown.
6. **Memory**: disimpan selamanya; token tetap dijaga lewat bounded retrieval.
7. **Cross-context**: target akhirnya unified per orang lintas DM/grup, tapi tetap sopan. Bubu tidak nyeplosin hal privat dari DM di grup kecuali orangnya sendiri yang mengangkat. User sudah menyetujui aturan ini pada 2026-05-30.

---

## 3. Ringkasan Implementasi Fase 1-4

### Fase 1 — Persistensi Forever

File utama:

- `chatContext.js`
- `modules/storage.js`
- `test/persistence.test.js`

Yang dilakukan:

- Memory/session summary tidak di-prune lagi oleh cap lama.
- Expiry active session dinaikkan dari 6 jam ke 24 jam.
- `BOT_DATA_DIR` didukung untuk isolasi test.
- `saveSessionMemory` dan `archiveSession` diexport untuk test/fase lanjutan.

### Fase 2 — Identitas Statis + Anti-Recite

File utama:

- `modules/bubuPersona.js`
- `modules/systemBlocks.js`
- `server.js`
- `test/bubuPersona.test.js`
- `test/systemBlocks.test.js`
- `test/liveReasoning.js`

Yang dilakukan:

- `buildBubuPersona({ botPhone })` menggantikan export `BUBU_PERSONA` lama.
- Persona statis menyertakan awareness WhatsApp/WAHA/nomor bot, tapi dengan framing "LATAR BELAKANG, BUKAN buat diucapin".
- `buildSystemBlocks(staticText, dynamicText)` memisahkan blok statis cached dan blok dinamis uncached.
- Anthropic `system` sekarang array block, dengan `cache_control: { type: 'ephemeral' }` di blok statis.

Catatan caching:

- Docs Anthropic per 2026-05-30: Claude Haiku 4.5 minimum cacheable prompt adalah 4.096 token.
- Live test masih menunjukkan `cache_creation_input_tokens=0` dan `cache_read_input_tokens=0`.
- Jadi struktur caching sudah benar, tapi **belum boleh diklaim hemat** sampai prompt statis melewati threshold / usage cache non-zero.

### Fase 3 — Awareness Dinamis DM/Grup + Sender

File utama:

- `modules/aiAdvanced.js`
- `server.js`
- `test/awarenessContext.test.js`
- `test/liveReasoning.js`

Yang dilakukan:

- `buildDynamicAwarenessContext(...)` membuat dynamic context berlabel LATAR BELAKANG.
- `buildRuntimeChatContext({ chatId, senderJid, payload })` derive:
  - `chatType`: `dm` / `group`
  - `chatName`: best-effort dari payload
  - `chatId`
  - `senderJid`
- `processIncomingPayload` membangun runtime chat context dan meneruskannya ke `handleNaturalLanguage`.
- `contextAwareResponse` sekarang menerima object options:

```js
contextAwareResponse(msg, askAI, { senderName, memoryContext, chatContext });
```

Backward compatibility positional args tetap dijaga:

```js
contextAwareResponse(msg, askAI, senderName, memoryContext);
```

### Fase 4 — Reply-Bubble Awareness

File utama:

- `modules/messageTriggers.js`
- `modules/aiAdvanced.js`
- `test/messageTriggers.test.js`
- `test/awarenessContext.test.js`
- `test/liveReasoning.js`

Yang dilakukan:

- `getQuotedMessageContext(payload)` diexport dari `modules/messageTriggers.js`.
- Helper ini membaca quoted/reply text dari:
  - `payload.replyTo`
  - `payload.reply_to`
  - `payload.quotedMsg`
  - `payload._data.quotedMsg`
- Text source yang dicoba:
  - `body`
  - `text`
  - `caption`
  - `_data.body`
  - `_data.text`
  - `_data.caption`
- Author source best-effort:
  - `participant`
  - `from`
  - `author`
  - `_data.participant`
  - `_data.author`
  - `_data.id.participant`
- `buildRuntimeChatContext` otomatis menyertakan `quotedMessage` hanya kalau quoted text ada.
- `buildDynamicAwarenessContext` merender quoted bubble sebagai 1 baris bounded 500 char:

```text
- Pesan ini me-reply bubble sebelumnya dari <author>: "<text>".
```

Ini tetap dynamic context, bukan hal yang harus diumumkan ke user.

---

## 4. Cara Test

Jangan pakai `node --test test/` di Windows setup ini. Listing file eksplisit.

Full unit suite saat ini:

```powershell
node --test test/persistence.test.js test/bubuPersona.test.js test/systemBlocks.test.js test/awarenessContext.test.js test/reasoning.test.js test/messageTriggers.test.js test/webhookDebug.test.js
```

Target terakhir terverifikasi:

```text
62/62 pass
```

Syntax checks:

```powershell
node -c server.js
node -c test/liveReasoning.js
```

Live Anthropic test:

```powershell
node test/liveReasoning.js
```

Target terakhir terverifikasi:

```text
10 scenarios
Banlist hits: 0
Policy fails: 0
Cache tokens: create=0 read=0
```

Live test butuh `.env` berisi `ANTHROPIC_API_KEY`. Script sudah memakai:

```js
require('dotenv').config({ override: true });
```

Ini penting karena shell pernah punya `ANTHROPIC_API_KEY=""` yang bisa mengalahkan `.env` kalau tidak override.

---

## 5. File Map

- `server.js`: Express app, webhook WAHA, `makeAskAI`, command router, `sendWA`, debug endpoints.
- `chatContext.js`: history, session memory, summaries, archive/expiry, relevant memory retrieval.
- `modules/bubuPersona.js`: persona statis Bubu dan anti-recite rules.
- `modules/systemBlocks.js`: Anthropic system block builder untuk static cached + dynamic uncached.
- `modules/aiAdvanced.js`: local intent/category, dynamic awareness context, runtime chat context, context-aware response.
- `modules/messageTriggers.js`: trigger detection, ID normalization, LID/mention/reply detection, quoted message extraction.
- `modules/aiFeatures.js`: gaya bahasa persona dan banlist Jaksel/English filler.
- `modules/reasoning.js`: parser `<reasoning>` / `<response>`.
- `modules/storage.js`: JSON storage, backup, `BOT_DATA_DIR` support.
- `modules/webhookDebug.js`: debug ring buffer.
- `test/liveReasoning.js`: live Anthropic behavior/policy check.
- `AWARENESS_NOTES.md`: blueprint dan roadmap lengkap. Sudah diupdate sampai Fase 4.

---

## 6. Gotcha Penting

1. **Jangan run server sembarangan**
   - `node server.js` bisa bind port dari `.env` dan bentrok dengan bot yang sedang jalan.
   - Pakai `node -c server.js` untuk syntax.

2. **Reasoning parser bergantung tag**
   - Persona wajib mempertahankan output:

```xml
<reasoning>...</reasoning>
<response>...</response>
```

   - Hanya `<response>` yang dikirim ke WhatsApp.

3. **Cache belum hemat**
   - Jangan claim prompt caching sudah menghemat biaya.
   - Live counters masih `create=0 read=0`.

4. **Group user pakai LID**
   - Payload grup bisa memakai `@lid`, bukan `@c.us`.
   - Ini blocker/riset utama Fase 5-6 untuk roster dan tagging.

5. **Storage test harus isolated**
   - Kalau test menyentuh storage/chatContext, set `process.env.BOT_DATA_DIR` sebelum require modul storage/chatContext. Lihat pola di `test/persistence.test.js`.

6. **Anti-recite harus dijaga**
   - Kalau menambah konteks baru, framing harus sebagai LATAR BELAKANG.
   - Jangan mendorong Bubu menyebut "kamu sedang di grup X" kecuali user bertanya langsung.

---

## 7. Next Step: Fase 5

### Tujuan

Bubu punya roster anggota grup yang bisa dipakai untuk:

- mengenali siapa saja anggota grup,
- memperkaya awareness grup,
- menjadi pondasi tagging di Fase 6,
- mulai menyelesaikan masalah LID vs nomor.

### Rencana awal yang disarankan

Tetap TDD. Pecah Fase 5 jadi beberapa langkah kecil:

1. **Create pure storage key/helper untuk group roster**
   - Misalnya `modules/groupRoster.js`.
   - Helper untuk normalize group id ke key storage aman.
   - Test dulu.

2. **Fetch participants dari WAHA**
   - Endpoint dari notes:

```text
GET /api/{session}/groups/{groupId}/participants/v2
```

   - Gunakan `WAHA_URL`, `WAHA_SESSION`, `WAHA_API_KEY`.
   - Jangan asumsi shape response. Buat debug/log sample dulu kalau perlu.

3. **Cache participants via `modules/storage.js`**
   - Key contoh: `group_members_<safeGroupId>`.
   - Simpan metadata:
     - `groupId`
     - `fetchedAt`
     - `participants`
     - raw-ish minimal fields yang aman untuk debugging LID.

4. **Command manual refresh**
   - Tambahkan command seperti `/refresh-members`.
   - Ini lebih aman daripada auto-fetch di startup untuk fase pertama.

5. **Riset LID**
   - Verifikasi apakah participants endpoint mengembalikan `@c.us`, `@lid`, atau campuran.
   - Bandingkan dengan `senderJid` dari webhook grup.
   - Catat hasil di `AWARENESS_NOTES.md`.

### Jangan langsung loncat ke Fase 6

Tagging beneran harus menunggu Fase 5 cukup jelas, karena `sendWA` perlu `mentions` array dan format mention harus benar. Salah format bisa cuma jadi teks `@nomor` tanpa notifikasi.

---

## 8. Suggested Tests for Fase 5

Tambahkan test baru, misalnya:

- `test/groupRoster.test.js`

Test pure functions:

- safe storage key dari group id.
- normalize participant id.
- cache save/load memakai `BOT_DATA_DIR`.
- mapping participant minimal.

Kalau menambahkan WAHA client wrapper, mock axios dengan dependency injection sederhana atau buat function yang menerima `httpGet` agar test tidak hit network.

Contoh shape yang enak dites:

```js
const createGroupRosterClient = ({ wahaUrl, session, apiKey, httpGet }) => ({
    fetchParticipants: async (groupId) => { /* ... */ },
});
```

---

## 9. Verification Baseline

Sebelum mulai Fase 5, jalankan:

```powershell
node -c server.js
node --test test/persistence.test.js test/bubuPersona.test.js test/systemBlocks.test.js test/awarenessContext.test.js test/reasoning.test.js test/messageTriggers.test.js test/webhookDebug.test.js
```

Setelah Fase 5, update command suite dengan test baru:

```powershell
node --test test/persistence.test.js test/bubuPersona.test.js test/systemBlocks.test.js test/awarenessContext.test.js test/groupRoster.test.js test/reasoning.test.js test/messageTriggers.test.js test/webhookDebug.test.js
```

Live test tetap:

```powershell
node test/liveReasoning.js
```

---

## 10. Recent Verified Results

Terakhir diverifikasi oleh Codex:

```text
node -c server.js                                    PASS
node -c test/liveReasoning.js                        PASS
full explicit unit suite                             62/62 PASS
node test/liveReasoning.js                           10 scenarios, banlist 0, policy fails 0
```

Commit terakhir yang berisi implementation:

```text
3aa412b Complete Bubu awareness phase 4
```

File handover ini dibuat setelah commit tersebut agar Opus/Antigravity bisa langsung lanjut dari Fase 5.
