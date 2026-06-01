# Bubu WhatsApp Bot - Architecture Review & Roadmap

## 1. Context & Scope
This document outlines the architectural findings and optimization roadmap for the Bubu WhatsApp Bot project. The codebase consists of ~18 module files and a robust test suite (~26 files, ~197 tests), employing a factory pattern for dependency injection, atomic storage layers, and token-optimized local heuristics before LLM calls.

The architecture is currently **production-grade** for personal/semi-public use. The recommendations here focus on hardening against scale, improving runtime efficiency, and fixing authorization gaps rather than structural refactoring.

## 2. Findings (Critical & Important Issues)

### 2.1. Critical Priority (Risk of Failure/OOM)
1. **Unbounded Session Memory Growth:**
   - **Where:** `chatContext.js` `saveSessionMemory()`
   - **Issue:** Memories are currently marked "forever" without a pruning mechanism. While retrieval uses indexed TF-IDF, `getMemoryCache()` loads the *entire array* into a Map when the TTL expires. Over time in active groups, this will cause memory spikes, slow down cache rebuilds, and increase latency.
   - **Solution:** Cap `session_memories` per `chatId` (e.g., max 50 memories per chat) and prune the oldest entries.

2. **Sequential Server Monitoring:**
   - **Where:** `automation.js` `checkAllServers()`
   - **Issue:** Iterates through monitors sequentially with `await checkServer()`. A timeout in one server blocks the loop for others.
   - **Solution:** Use `Promise.all()` to check servers in parallel.

3. **Missing Command Authorization:**
   - **Where:** `commands.js`
   - **Issue:** Sensitive commands (`/diem`, `/aktif`, `/reset`) lack authorization. Any group member can execute them, posing a risk of abuse (e.g., disabling the bot).
   - **Solution:** Add an owner check via `process.env.BOT_OWNER_PHONE` or a defined admin list.

### 2.2. Important Priority (Maintainability & Cost)
1. **SRP Violation in Automation Module:**
   - **Where:** `automation.js`
   - **Issue:** The file handles two unrelated responsibilities: Recurring Reminders and Server Monitoring.
   - **Solution:** Split into `reminders.js` and `serverMonitor.js`.

2. **Hardcoded Morning Brief:**
   - **Where:** `server.js` (cron schedule)
   - **Issue:** The Morning Brief is a hardcoded cron job, not integrated with the `automation.js` reminder system. It cannot be disabled, rescheduled, or modified via WhatsApp commands.
   - **Solution:** Migrate the Morning Brief to the configurable reminder system.

3. **Roster Caching lacks TTL:**
   - **Where:** `groupRoster.js` `loadRoster()`
   - **Issue:** Group rosters are cached indefinitely until `/refresh-members` is called manually.
   - **Solution:** Implement a TTL (e.g., 6 hours) or auto-invalidate based on specific events.

4. **Missing Prompt Caching:**
   - **Where:** AI call configuration
   - **Issue:** The static `BUBU_PERSONA` is sent repeatedly without Anthropic's prompt caching (`cache_control: { type: "ephemeral" }`).
   - **Solution:** Apply prompt caching to the system prompt to reduce costs by 60-80%.

5. **Inefficient O(n) Cleanup:**
   - **Where:** `chatContext.js` `getHistory()`
   - **Issue:** Calls `cleanExpired()` which scans *all* sessions on every request.
   - **Solution:** Change to lazy per-chat cleanup or run `cleanExpired()` on a separate background interval.

## 3. Implementation Roadmap

### Phase 1: Hardening & Security (Tier 1)
- **T1-A:** Implement pruning logic in `chatContext.js` to bound `session_memories` growth (cap at 50 per chat).
- **T1-B:** Refactor `automation.js` `checkAllServers` to run HTTP checks in parallel via `Promise.all()`.
- **T1-C:** Implement a middleware/wrapper in `commands.js` to restrict sensitive commands to a predefined `BOT_OWNER_PHONE`.

### Phase 2: Efficiency & Maintainability (Tier 2)
- **T2-A:** Add Anthropic prompt caching parameters to the system blocks.
- **T2-B:** Add TTL logic to `groupRoster.js` so `loadRoster` fetches fresh data if older than 6 hours.
- **T2-C:** Split `automation.js` into two distinct modules: `reminders.js` and `serverMonitor.js`, updating `server.js` and `commands.js` imports.

### Phase 3: Technical Debt (Tier 3)
- **T3-A:** Remove the hardcoded 06:30 cron job in `server.js` and seed it as a default recurring reminder in the storage system instead.
- **T3-B:** Refactor `cleanExpired()` to run periodically (e.g., every 5 minutes via `setInterval`) instead of per-message.
- **T3-C:** Convert the in-memory rate limiter in `server.js` to use `storage.js` or a TTL cache for persistence.
