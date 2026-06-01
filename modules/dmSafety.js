// Safety guard for AI-emitted <dm target="..."> tags.
// Only sends DM to contacts known from current DM, current sender, canonical sender,
// or group roster participants. Unknown targets are blocked and surfaced to chat.

const normalizeDmTarget = (target) => {
    const raw = String(target || '').trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (lower.endsWith('@lid')) return '';
    if (lower.endsWith('@s.whatsapp.net')) {
        const phone = raw.slice(0, -'@s.whatsapp.net'.length).replace(/\D/g, '');
        return phone ? `${phone}@c.us` : '';
    }
    if (lower.endsWith('@c.us')) {
        const phone = raw.slice(0, -'@c.us'.length).replace(/\D/g, '');
        return phone ? `${phone}@c.us` : '';
    }
    const phone = raw.replace(/\D/g, '');
    return phone ? `${phone}@c.us` : '';
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
    const targets = blocked.map(dm => dm.target).filter(Boolean).join(', ') || 'target itu';
    const notice = `Bubu belum bisa DM ${targets} karena kontaknya belum dikenal.`;
    return reply ? `${reply}\n\n${notice}` : notice;
};

module.exports = {
    normalizeDmTarget,
    collectKnownDmTargets,
    splitAllowedDMs,
    appendBlockedDmNotice,
};
