# Tier-3 Test Baseline & Import Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bersihkan baseline setelah Tier-2E: hapus dead imports di `server.js`, pisahkan deterministic unit tests dari live Anthropic reasoning test, dan buat live test tidak menggagalkan workflow saat external credentials/provider belum aktif.

**Architecture:** `npm test` menjadi deterministic-only (`test/*.test.js`) sehingga tidak memanggil Anthropic. `npm run test:live` menjalankan `test/liveReasoning.js` untuk validasi API nyata. `liveReasoning.js` tetap executable, tapi jika provider/credential Anthropic tidak aktif ia melaporkan SKIP dan exit 0, bukan menggagalkan test baseline.

**Tech Stack:** Node.js built-in `node:test`, CommonJS, npm scripts.

---

## File Structure

**Modify:**
- `server.js` — remove imports yang sudah mati setelah Tier-2E extraction.
- `package.json` — split scripts: `test`, `test:live`, `test:all`.
- `test/liveReasoning.js` — graceful skip on missing/inactive Anthropic provider credentials.

**Create:**
- `test/packageScripts.test.js` — deterministic test that locks package scripts so live test stays out of `npm test`.

---

## Task 1: Remove dead imports from server.js

**Files:**
- Modify: `server.js:6-50`

- [ ] **Step 1: Remove unused imports**

In `server.js`, replace the current import section:

```javascript
const { getHistory, addMessage, clearHistory, getStats, getSummaries, getRelevantMemory, withChatLock } = require('./chatContext');
const {
    classifyIntent,
    autoCategorize,
    buildRuntimeChatContext,
    contextAwareResponse,
    summarizeConversation,
} = require('./modules/aiAdvanced');
const { getPersonaPrompt, getActivePersonaName } = require('./modules/aiFeatures');
const { loadAndStartReminders, manageRecurringReminder, manageServerMonitor, checkAllServers } = require('./modules/automation');
const {
    createBotTriggerState,
    detectMessageTrigger,
    getPayloadChatId,
    getPayloadSenderId,
    isOutgoingMessage,
    learnBotMentionFromIncoming,
    messageIdCandidates,
    rememberBotMessage,
} = require('./modules/messageTriggers');
const { createDebugStore, previewText, safeError } = require('./modules/webhookDebug');
const { parseBubuReply, extractDMs, stripDMTags } = require('./modules/reasoning');
const { buildBubuPersona } = require('./modules/bubuPersona');
const { buildSystemBlocks } = require('./modules/systemBlocks');
const {
    createGroupRosterClient,
    fetchAndCacheRoster,
    loadRoster,
} = require('./modules/groupRoster');
const { createLidResolver } = require('./modules/lidResolver');
const {
    extractMentionIntents,
    formatMentionedReply,
    guardMentions,
} = require('./modules/mentionHelper');
const {
    shouldConsiderProactive,
    checkProactiveCooldown,
    markProactiveSent,
    saveProactiveState,
    isProactiveEnabled,
    PROACTIVE_SKIP_MARKER,
} = require('./modules/proactiveGuard');
const { createCooldownStore } = require('./modules/cooldownStore');
const { getCrypto, getMultipleCrypto, getKurs } = require('./modules/crypto');
```

with this cleaned import section:

```javascript
const { getHistory, addMessage, getRelevantMemory } = require('./chatContext');
const {
    classifyIntent,
    autoCategorize,
    contextAwareResponse,
} = require('./modules/aiAdvanced');
const { getPersonaPrompt } = require('./modules/aiFeatures');
const { loadAndStartReminders, checkAllServers } = require('./modules/automation');
const {
    createBotTriggerState,
    getPayloadChatId,
    messageIdCandidates,
    rememberBotMessage,
} = require('./modules/messageTriggers');
const { createDebugStore, previewText, safeError } = require('./modules/webhookDebug');
const { parseBubuReply } = require('./modules/reasoning');
const { buildBubuPersona } = require('./modules/bubuPersona');
const { buildSystemBlocks } = require('./modules/systemBlocks');
const { createGroupRosterClient } = require('./modules/groupRoster');
const { createLidResolver } = require('./modules/lidResolver');
const { guardMentions } = require('./modules/mentionHelper');
const { createCooldownStore } = require('./modules/cooldownStore');
const { getMultipleCrypto } = require('./modules/crypto');
```

Keep the existing imports below this block intact:

```javascript
const { createCommandHandler } = require('./modules/commands');
const { createWebhookProcessor } = require('./modules/webhookProcessor');
const lifecycle = require('./modules/lifecycle');
```

- [ ] **Step 2: Verify syntax + deterministic tests**

Run:

```bash
cd D:/Website/bot-projects/bot_wa
node -c server.js
node --test test/*.test.js
```

Expected: syntax OK, all deterministic tests pass.

- [ ] **Step 3: Commit**

```bash
git add server.js
git commit -m "chore(server): remove dead imports after tier-2 refactor"
```

---

## Task 2: Split deterministic vs live test scripts

**Files:**
- Modify: `package.json:5-8`
- Create: `test/packageScripts.test.js`

- [ ] **Step 1: Write failing package script test**

Create `test/packageScripts.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('npm test runs deterministic .test.js files only', () => {
    assert.equal(pkg.scripts.test, 'node --test test/*.test.js');
});

test('npm run test:live runs live Anthropic reasoning check', () => {
    assert.equal(pkg.scripts['test:live'], 'node --test test/liveReasoning.js');
});

test('npm run test:all runs deterministic then live checks', () => {
    assert.equal(pkg.scripts['test:all'], 'npm test && npm run test:live');
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test test/packageScripts.test.js
```

Expected: FAIL because `package.json` still has `"test": "node --test"` and no `test:live` / `test:all`.

- [ ] **Step 3: Update package.json scripts**

Replace the scripts block in `package.json`:

```json
"scripts": {
  "start": "node server.js",
  "test": "node --test"
},
```

with:

```json
"scripts": {
  "start": "node server.js",
  "test": "node --test test/*.test.js",
  "test:live": "node --test test/liveReasoning.js",
  "test:all": "npm test && npm run test:live"
},
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
node --test test/packageScripts.test.js
npm test
```

Expected: package script test passes; `npm test` runs deterministic `.test.js` files only and passes. It must NOT run `test/liveReasoning.js`.

- [ ] **Step 5: Commit**

```bash
git add package.json test/packageScripts.test.js
git commit -m "test: split deterministic and live reasoning test scripts"
```

---

## Task 3: Make liveReasoning skip inactive Anthropic provider credentials

**Files:**
- Modify: `test/liveReasoning.js`

- [ ] **Step 1: Add live skip helpers**

In `test/liveReasoning.js`, after the `escapeRe` helper (currently around line 164):

```javascript
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
```

add:

```javascript
const isCredentialOrProviderUnavailable = (error) => {
    const msg = String(error?.message || error || '');
    const code = String(error?.code || error?.error?.code || '');
    const type = String(error?.type || error?.error?.type || '');
    return /No active credentials|model_not_found|invalid_request_error/i.test(`${msg} ${code} ${type}`);
};
```

- [ ] **Step 2: Add externalUnavailable flag**

Inside `run`, after:

```javascript
let totalPolicyFailures = 0;
```

add:

```javascript
let externalUnavailable = false;
```

- [ ] **Step 3: Update catch block inside scenario loop**

Replace the current catch block in the scenario loop:

```javascript
        } catch (e) {
            console.log(`\n[${sc.label}] ERROR: ${e?.message || e}`);
            console.log('-'.repeat(72));
            allHasReasoning = false;
            allHasResponse = false;
        }
```

with:

```javascript
        } catch (e) {
            if (isCredentialOrProviderUnavailable(e)) {
                console.log(`\n[${sc.label}] SKIP: Anthropic provider/credentials unavailable (${e?.message || e})`);
                console.log('-'.repeat(72));
                externalUnavailable = true;
                break;
            }
            console.log(`\n[${sc.label}] ERROR: ${e?.message || e}`);
            console.log('-'.repeat(72));
            allHasReasoning = false;
            allHasResponse = false;
        }
```

- [ ] **Step 4: Update summary exit behavior**

Right before the existing final failure condition:

```javascript
    if (!allHasReasoning || !allHasResponse || totalBanHits > 0 || totalPolicyFailures > 0) {
        process.exitCode = 1;
    }
```

insert:

```javascript
    if (externalUnavailable) {
        console.log('  Live status: SKIPPED (Anthropic provider/credentials unavailable)');
        return;
    }
```

Final block becomes:

```javascript
    if (externalUnavailable) {
        console.log('  Live status: SKIPPED (Anthropic provider/credentials unavailable)');
        return;
    }

    if (!allHasReasoning || !allHasResponse || totalBanHits > 0 || totalPolicyFailures > 0) {
        process.exitCode = 1;
    }
```

- [ ] **Step 5: Verify live skip behavior**

Run:

```bash
npm run test:live
```

Expected in current environment if credentials/provider inactive: command exits 0 and output includes `Live status: SKIPPED`. If credentials are active, it runs the live scenarios normally.

Then run:

```bash
npm test
```

Expected: deterministic tests pass and do not run live reasoning.

- [ ] **Step 6: Commit**

```bash
git add test/liveReasoning.js
git commit -m "test(live): skip reasoning check when Anthropic provider is unavailable"
```

---

## Self-Review

**Spec coverage:**
- Cleanup dead imports: Task 1.
- Deterministic vs live test split: Task 2.
- Live skip for inactive provider credentials: Task 3.

**Placeholder scan:** No TODO/TBD; every code edit and command is explicit.

**Type consistency:** package script keys: `test`, `test:live`, `test:all`. Live skip helper name used exactly once in catch block.

**Risk:** Task 1 is mechanical import cleanup. Task 2 changes default `npm test`, but only to exclude non-`.test.js` live file. Task 3 affects only live test behavior.
