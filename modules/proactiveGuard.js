// ==========================================
// PROACTIVE GUARD MODULE — Fase 7
// Kill-switch, pre-filter, cooldown, skip gate
// for proactive group behavior.
// ==========================================

const storage = require('./storage');

// ── Constants ────────────────────────────────────────────────────

const PROACTIVE_COOLDOWN_MS = 300_000; // 5 minutes per group
const PROACTIVE_SKIP_MARKER = '[SKIP]';
const MIN_MSG_LENGTH = 8; // ignore very short messages like "ok?", "wkwk"

/**
 * Categories that justify proactive engagement.
 * Others (GREETING, INFO, REQUEST, URGENT) are dropped.
 */
const PROACTIVE_CATEGORIES = new Set(['PERTANYAAN', 'DISKUSI']);

// ── Kill-switch state (persisted via storage) ────────────────────

const stateKey = (groupId) => `proactive_state_${String(groupId).replace(/@g\.us$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;

/**
 * Load proactive on/off state for a group. Default: OFF (false).
 */
const loadProactiveState = (groupId) => {
    const data = storage.load(stateKey(groupId), null);
    if (!data || typeof data.enabled !== 'boolean') return false;
    return data.enabled;
};

/**
 * Persist proactive on/off state for a group.
 */
const saveProactiveState = (groupId, enabled) => {
    storage.save(stateKey(groupId), { groupId, enabled, updatedAt: new Date().toISOString() });
};

/**
 * Check if proactive mode is enabled for a group.
 */
const isProactiveEnabled = (groupId) => loadProactiveState(groupId);

// ── Pre-filter ───────────────────────────────────────────────────

/**
 * Determine if a group message should be considered for proactive response.
 * This is the LOCAL (free) pre-filter — no LLM call needed.
 *
 * @param {{ groupId: string, category: string, msgBody: string }} opts
 * @returns {boolean}
 */
const shouldConsiderProactive = ({ groupId, category, msgBody }) => {
    // Must be enabled for this group
    if (!isProactiveEnabled(groupId)) return false;

    // Only qualifying categories
    if (!PROACTIVE_CATEGORIES.has(category)) return false;

    // Skip very short / receh messages
    if (!msgBody || msgBody.trim().length < MIN_MSG_LENGTH) return false;

    return true;
};

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

/**
 * Check if proactive response is allowed (cooldown elapsed).
 * @param {string} groupId
 * @param {number} cooldownMs - override for testing
 * @returns {{ allowed: boolean, remainingMs: number }}
 */
const checkProactiveCooldown = (groupId, cooldownMs = PROACTIVE_COOLDOWN_MS) => {
    const now = Date.now();
    const last = proactiveCooldownMap.get(groupId) || 0;
    const elapsed = now - last;

    if (elapsed >= cooldownMs) {
        return { allowed: true, remainingMs: 0 };
    }
    return { allowed: false, remainingMs: cooldownMs - elapsed };
};

/**
 * Record that a proactive message was sent for this group.
 */
const markProactiveSent = (groupId) => {
    proactiveCooldownMap.set(groupId, Date.now());
    persistCooldowns();
};

/**
 * Reset cooldown for a group (e.g., for testing).
 */
const resetProactiveCooldown = (groupId) => {
    proactiveCooldownMap.delete(groupId);
    persistCooldowns();
};

module.exports = {
    PROACTIVE_COOLDOWN_MS,
    PROACTIVE_SKIP_MARKER,
    PROACTIVE_CATEGORIES,
    loadProactiveState,
    saveProactiveState,
    isProactiveEnabled,
    shouldConsiderProactive,
    checkProactiveCooldown,
    markProactiveSent,
    resetProactiveCooldown,
};
