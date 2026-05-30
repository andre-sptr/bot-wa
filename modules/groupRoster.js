// ==========================================
// GROUP ROSTER MODULE — Fase 5
// Fetch + cache grup participants via WAHA.
// ==========================================

const storage = require('./storage');

// ── Pure helpers ─────────────────────────────────────────────────

/**
 * Normalize group ID to a safe storage key.
 * e.g. '120363424766297041@g.us' → 'group_roster_120363424766297041'
 */
const safeGroupStorageKey = (groupId) => {
    const stripped = String(groupId || '')
        .replace(/@g\.us$/i, '')
        .replace(/[^a-zA-Z0-9_-]/g, '_');
    return `group_roster_${stripped}`;
};

/**
 * Extract minimal fields from a raw WAHA participant object.
 * Handles both string IDs and nested { _serialized } objects.
 */
const normalizeParticipant = (raw) => {
    if (!raw || typeof raw !== 'object') {
        return { id: '', role: 'participant', name: '' };
    }

    let id = '';
    if (typeof raw.id === 'string') {
        id = raw.id;
    } else if (raw.id && typeof raw.id === 'object') {
        id = raw.id._serialized || raw.id.id || '';
    }

    return {
        id: String(id || ''),
        role: String(raw.role || 'participant'),
        name: String(raw.name || ''),
    };
};

/**
 * Pick the best display name from a WAHA contact response.
 * participants/v2 omits names, so names come from the contacts endpoint.
 * Prefers name → pushname → shortName.
 */
const pickContactName = (data) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
    return String(data.name || data.pushname || data.shortName || '').trim();
};

// ── Storage helpers ──────────────────────────────────────────────

/**
 * Save normalized roster to storage.
 */
const saveRoster = (groupId, participants) => {
    const key = safeGroupStorageKey(groupId);
    const roster = {
        groupId,
        fetchedAt: new Date().toISOString(),
        participants,
    };
    storage.save(key, roster);
    return roster;
};

/**
 * Load cached roster from storage. Returns null if not found.
 */
const loadRoster = (groupId) => {
    const key = safeGroupStorageKey(groupId);
    const data = storage.load(key, null);
    if (!data || !data.groupId) return null;
    return data;
};

// ── WAHA client ──────────────────────────────────────────────────

/**
 * Factory: create a group roster client with injected HTTP getter.
 * This makes the module testable without hitting real WAHA.
 *
 * @param {{ wahaUrl: string, session: string, apiKey: string, httpGet: Function }} opts
 */
const createGroupRosterClient = ({ wahaUrl, session, apiKey, httpGet }) => {
    return {
        /**
         * Fetch participants for a group from WAHA.
         * @param {string} groupId - e.g. '120363424766297041@g.us'
         * @returns {Promise<Array>} normalized participant array
         */
        fetchParticipants: async (groupId) => {
            const url = `${wahaUrl}/api/${session}/groups/${groupId}/participants/v2`;
            const response = await httpGet(url, {
                headers: { 'X-Api-Key': apiKey },
                timeout: 10000,
            });
            const raw = Array.isArray(response.data) ? response.data : [];
            return raw.map(normalizeParticipant);
        },

        /**
         * Fetch a contact's display name from WAHA. Resilient: returns ''
         * on any error (never throws), so roster enrichment can't crash.
         * @param {string} contactId - e.g. '6289618750563@c.us'
         * @returns {Promise<string>}
         */
        fetchContactName: async (contactId) => {
            try {
                const url = `${wahaUrl}/api/contacts?session=${encodeURIComponent(session)}&contactId=${encodeURIComponent(contactId)}`;
                const response = await httpGet(url, {
                    headers: { 'X-Api-Key': apiKey },
                    timeout: 10000,
                });
                return pickContactName(response?.data);
            } catch {
                return '';
            }
        },
    };
};

// ── Fetch + cache combo ──────────────────────────────────────────

/**
 * Fetch participants from WAHA, normalize, and save to storage.
 * Returns the roster object, or null on failure.
 */
const fetchAndCacheRoster = async ({ client, groupId }) => {
    try {
        const participants = await client.fetchParticipants(groupId);

        // Enrich with names: participants/v2 omits names, so fetch each member's
        // display name from the contacts endpoint. Existing names are preserved.
        if (typeof client.fetchContactName === 'function') {
            await Promise.all(participants.map(async (p) => {
                if (p.name || !p.id) return;
                p.name = await client.fetchContactName(p.id);
            }));
        }

        return saveRoster(groupId, participants);
    } catch (err) {
        console.error(`[GroupRoster] Failed to fetch roster for ${groupId}:`, err?.message || err);
        return null;
    }
};

module.exports = {
    safeGroupStorageKey,
    normalizeParticipant,
    pickContactName,
    saveRoster,
    loadRoster,
    createGroupRosterClient,
    fetchAndCacheRoster,
};
