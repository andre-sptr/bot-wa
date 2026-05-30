// ==========================================
// MENTION HELPER MODULE — Fase 6
// Extract, resolve, and format @mentions
// for WAHA sendText mentions array.
// ==========================================

// ── phoneMentionable ─────────────────────────────────────────────

/**
 * Check if a participant ID is phone-based (mentionable via WAHA).
 * @c.us and @s.whatsapp.net → mentionable. @lid → not mentionable.
 * Returns { phone, jid } or null.
 */
const phoneMentionable = (participantId) => {
    if (!participantId || typeof participantId !== 'string') return null;
    const id = participantId.trim();

    if (id.endsWith('@c.us')) {
        const phone = id.slice(0, -'@c.us'.length);
        return phone ? { phone, jid: id } : null;
    }
    if (id.endsWith('@s.whatsapp.net')) {
        const phone = id.slice(0, -'@s.whatsapp.net'.length);
        return phone ? { phone, jid: `${phone}@c.us` } : null;
    }

    return null;
};

// ── Blocked mention targets ──────────────────────────────────────

const TAG_ALL_KEYWORDS = new Set(['all', 'everyone', 'semua']);

// ── extractMentionIntents ────────────────────────────────────────

/**
 * Build lookup maps from roster participants for fast matching.
 */
const buildLookups = (participants) => {
    const byNameLower = new Map();      // lowercase full name → participant
    const byFirstNameLower = new Map(); // lowercase first name → participant
    const byPhoneLocal = new Map();     // phone local part → participant

    for (const p of participants) {
        if (p.name) {
            const lower = p.name.toLowerCase();
            if (!byNameLower.has(lower)) byNameLower.set(lower, p);
            const first = lower.split(/\s+/)[0];
            if (first && !byFirstNameLower.has(first)) byFirstNameLower.set(first, p);
        }
        const mentionable = phoneMentionable(p.id);
        if (mentionable) {
            byPhoneLocal.set(mentionable.phone, p);
        }
    }

    return { byNameLower, byFirstNameLower, byPhoneLocal };
};

/**
 * Strip trailing punctuation that AI often appends after @mentions.
 * e.g. "@Ardian," → "Ardian", "@Andre!" → "Andre", "@Rina." → "Rina"
 */
const stripTrailingPunctuation = (raw) => raw.replace(/[.,!?;:)\]]+$/, '');

/**
 * Find @mentions in AI output text and resolve against roster participants.
 * Returns array of { matchedText, participant } (deduplicated by participant id).
 * When @all/@semua/@everyone is found, returns ALL mentionable participants.
 *
 * @param {string} text - AI output text
 * @param {Array} participants - roster participants [{ id, role, name }]
 */
const extractMentionIntents = (text, participants) => {
    if (!text || !participants || participants.length === 0) return [];

    const pattern = /@(\S+)/g;
    const lookups = buildLookups(participants);
    const seen = new Set();
    const intents = [];
    let hasTagAll = false;

    let match;
    while ((match = pattern.exec(text)) !== null) {
        const raw = match[1];
        const cleaned = stripTrailingPunctuation(raw);
        const lower = cleaned.toLowerCase();

        // Detect tag-all keywords
        if (TAG_ALL_KEYWORDS.has(lower)) {
            hasTagAll = true;
            continue;
        }

        // Try matching: full name → first name → phone number
        // Try both cleaned (without trailing punctuation) and raw (as-is)
        const participant =
            lookups.byNameLower.get(lower) ||
            lookups.byFirstNameLower.get(lower) ||
            lookups.byPhoneLocal.get(cleaned) ||
            lookups.byPhoneLocal.get(raw) ||
            null;

        if (participant && !seen.has(participant.id)) {
            seen.add(participant.id);
            intents.push({ matchedText: match[0], participant });
        }
    }

    // Tag-all: add ALL mentionable participants not already included
    if (hasTagAll) {
        for (const p of participants) {
            if (!seen.has(p.id) && phoneMentionable(p.id)) {
                seen.add(p.id);
                intents.push({ matchedText: '@all', participant: p });
            }
        }
    }

    return intents;
};

// ── formatMentionedReply ─────────────────────────────────────────

/**
 * Replace @NamaOrang with @phone in text and build WAHA mentions array.
 * Only mentionable (@c.us) participants get replaced; @lid stay as-is.
 *
 * @param {string} text - AI reply text with @Name patterns
 * @param {Array} intents - from extractMentionIntents
 * @returns {{ text: string, mentions: string[] }}
 */
const formatMentionedReply = (text, intents) => {
    if (!intents || intents.length === 0) {
        return { text, mentions: [] };
    }

    let formatted = text;
    const mentions = [];
    const replacedTexts = new Set();

    for (const intent of intents) {
        const mentionable = phoneMentionable(intent.participant.id);
        if (!mentionable) continue; // @lid — leave as-is

        // Replace @Name with @phone in text (only if not already replaced)
        if (intent.matchedText === '@all') {
            // For tag-all participants, just add to mentions — don't replace text per participant
            mentions.push(mentionable.jid);
        } else if (!replacedTexts.has(intent.matchedText)) {
            formatted = formatted.replace(intent.matchedText, `@${mentionable.phone}`);
            replacedTexts.add(intent.matchedText);
            mentions.push(mentionable.jid);
        }
    }

    // If we had @all, also replace the @all/@semua/@everyone keyword in text
    // with a list of @phone mentions (or just replace with @all placeholder)
    if (intents.some(i => i.matchedText === '@all')) {
        formatted = formatted.replace(/@(all|semua|everyone)/gi, (m) => {
            // Build the @phone list for all tagged participants from @all
            const allPhones = intents
                .filter(i => i.matchedText === '@all')
                .map(i => phoneMentionable(i.participant.id))
                .filter(Boolean)
                .map(m => `@${m.phone}`);
            return allPhones.length > 0 ? allPhones.join(' ') : m;
        });
    }

    return { text: formatted, mentions };
};

// ── guardMentions ────────────────────────────────────────────────

/**
 * Safety guard: cap mention count and validate JID format.
 *
 * @param {Array|null} mentions - mentions array
 * @param {number} maxPerMessage - max mentions per message (default 50)
 * @returns {string[]}
 */
const guardMentions = (mentions, maxPerMessage = 50) => {
    if (!Array.isArray(mentions)) return [];
    return mentions
        .filter(m => typeof m === 'string' && m.includes('@'))
        .slice(0, maxPerMessage);
};

module.exports = {
    phoneMentionable,
    extractMentionIntents,
    formatMentionedReply,
    guardMentions,
};
