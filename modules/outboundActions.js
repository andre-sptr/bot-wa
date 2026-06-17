const cleanText = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const stripBotPrefix = (text) => cleanText(text)
    .replace(/^bubu[\s,;:.-]+/i, '')
    .replace(/^bu[\s,;:.-]+/i, '');

const normalizedAction = (type, targetText, message) => {
    const target = cleanText(targetText);
    const body = cleanText(message);
    if (!target || !body) return null;
    return { type, targetText: target, message: body };
};

const parseOutboundRequests = (text) => {
    const input = stripBotPrefix(text);
    if (!input || input.startsWith('/')) return [];

    const patterns = [
        {
            type: 'send_group',
            re: /^(?:kirim(?:kan)?\s+ke|chat(?:\s+ke)?)\s+grup\s+(.+?)\s+(?:bilang|pesan(?:nya)?|isi(?:nya)?)\s+(.+)$/i,
        },
        {
            type: 'send_dm',
            re: /^(?:dm|chat(?:\s+ke)?)\s+(.+?)\s+(?:bilang|pesan(?:nya)?|isi(?:nya)?)\s+(.+)$/i,
        },
        {
            type: 'send_dm',
            re: /^kirim(?:kan)?\s+pesan\s+ke\s+(.+?)\s+(?:bilang|pesan(?:nya)?|isi(?:nya)?)\s+(.+)$/i,
        },
        {
            type: 'send_dm',
            re: /^bilangin\s+(\S+)\s+(.+)$/i,
        },
    ];

    for (const { type, re } of patterns) {
        const match = input.match(re);
        if (!match) continue;
        const action = normalizedAction(type, match[1], match[2]);
        return action ? [action] : [];
    }

    return [];
};

const confirmationFor = (action, resolved) => {
    const name = cleanText(resolved?.name) || action.targetText;
    if (action.type === 'send_group') return `Bubu udah kirim ke grup ${name}.`;
    return `Bubu udah chat ${name}.`;
};

const blockedMessageFor = (action, resolved) => {
    if (!resolved) return `Bubu belum nemu kontak atau grup ${action.targetText}.`;
    if (resolved.ambiguous) return `Bubu nemu terlalu banyak pilihan untuk ${action.targetText}. Sebut lebih spesifik ya.`;
    if (action.type === 'send_group') return `${action.targetText} ketemunya bukan grup.`;
    return `${action.targetText} ketemunya bukan kontak pribadi.`;
};

const failureMessageFor = (action, resolved) => {
    const name = cleanText(resolved?.name) || action.targetText;
    if (action.type === 'send_group') return `Bubu gagal kirim ke grup ${name}, coba lagi ya.`;
    return `Bubu gagal kirim ke ${name}, coba lagi ya.`;
};

const isCompatibleTarget = (action, resolved) => {
    if (!resolved || resolved.ambiguous) return false;
    if (action.type === 'send_group') return resolved.type === 'group';
    if (action.type === 'send_dm') return resolved.type === 'dm';
    return false;
};

const resolveCanonicalId = async (id, resolveLid) => {
    const targetId = String(id || '');
    if (!targetId.endsWith('@lid') || typeof resolveLid !== 'function') return targetId;
    try {
        const canonical = await resolveLid(targetId);
        if (canonical && String(canonical).endsWith('@c.us')) return String(canonical);
    } catch { /* keep @lid; sendWA failure is reported honestly */ }
    return targetId;
};

const executeOutboundRequests = async ({
    actions = [],
    directory,
    sendWA,
    originChatId,
    resolveLid,
} = {}) => {
    const result = { sent: [], blocked: [], failed: [] };
    if (!Array.isArray(actions) || actions.length === 0) return result;

    for (const action of actions) {
        const resolved = directory?.resolveChat ? directory.resolveChat(action.targetText) : null;

        if (!isCompatibleTarget(action, resolved)) {
            const blocked = { action, target: resolved || null, reason: resolved?.ambiguous ? 'ambiguous' : 'unresolved' };
            result.blocked.push(blocked);
            if (originChatId && typeof sendWA === 'function') {
                await sendWA(blockedMessageFor(action, resolved), originChatId, []);
            }
            continue;
        }

        // WAHA sends to <number>@c.us; resolve @lid targets first so the message actually lands.
        const targetId = await resolveCanonicalId(resolved.id, resolveLid);

        // Only confirm success if the underlying send actually succeeded.
        // sendWA returns { ok, error }; treat a missing return as success for backward compatibility.
        const sendResult = await sendWA(action.message, targetId, []);
        const sent = !sendResult || sendResult.ok !== false;

        if (!sent) {
            result.failed.push({ action, target: resolved, error: sendResult.error || null });
            if (originChatId) {
                await sendWA(failureMessageFor(action, resolved), originChatId, []);
            }
            continue;
        }

        result.sent.push({ action, target: resolved });
        if (originChatId) {
            await sendWA(confirmationFor(action, resolved), originChatId, []);
        }
    }

    return result;
};

module.exports = {
    parseOutboundRequests,
    executeOutboundRequests,
};
