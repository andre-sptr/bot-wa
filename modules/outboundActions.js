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

const isCompatibleTarget = (action, resolved) => {
    if (!resolved || resolved.ambiguous) return false;
    if (action.type === 'send_group') return resolved.type === 'group';
    if (action.type === 'send_dm') return resolved.type === 'dm';
    return false;
};

const executeOutboundRequests = async ({
    actions = [],
    directory,
    sendWA,
    originChatId,
} = {}) => {
    const result = { sent: [], blocked: [] };
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

        await sendWA(action.message, resolved.id, []);
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
