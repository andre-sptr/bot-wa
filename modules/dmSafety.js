// Safety guard for AI-emitted DM targets. Only allows known contacts (current DM/sender, group roster) and blocks unknown targets.

const normalizeDmTarget = (target) => {
    const raw = String(target || '').trim();
    if (!raw) return '';

    const canonical = raw.match(/^(\d+)@c\.us$/i);
    if (canonical) return `${canonical[1]}@c.us`;

    const whatsapp = raw.match(/^(\d+)@s\.whatsapp\.net$/i);
    if (whatsapp) return `${whatsapp[1]}@c.us`;

    return '';
};

const addKnown = (set, value) => {
    const normalized = normalizeDmTarget(value);
    if (normalized) set.add(normalized);
};

const collectKnownDmTargets = ({ chatId, senderJid, canonicalSenderJid, roster } = {}) => {
    const known = new Set();
    addKnown(known, chatId);
    addKnown(known, senderJid);
    addKnown(known, canonicalSenderJid);
    if (Array.isArray(roster?.participants)) {
        for (const p of roster.participants) addKnown(known, p.id);
    }
    return known;
};

const splitAllowedDMs = (dms, knownTargets) => {
    const allowed = [];
    const blocked = [];
    for (const dm of dms || []) {
        const target = normalizeDmTarget(dm.target);
        const entry = { target: target || String(dm.target || '').trim(), message: dm.message };
        if (target && knownTargets?.has(target)) allowed.push(entry);
        else blocked.push(entry);
    }
    return { allowed, blocked };
};

const appendBlockedDmNotice = (reply, blocked) => {
    if (!Array.isArray(blocked) || blocked.length === 0) return reply;
    const notice = `Bubu belum bisa DM kontak itu karena kontaknya belum dikenal.`;
    return reply ? `${reply}\n\n${notice}` : notice;
};

module.exports = {
    normalizeDmTarget,
    collectKnownDmTargets,
    splitAllowedDMs,
    appendBlockedDmNotice,
};
