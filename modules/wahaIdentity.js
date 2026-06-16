const asSerializedId = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number') return String(value);
    if (typeof value === 'object') {
        const nested = value._serialized ?? value.serialized ?? value.id ?? value.ID ?? value.Id ?? '';
        return nested === value ? '' : asSerializedId(nested);
    }
    return '';
};

const normalizeIdText = (value) => asSerializedId(value).trim().toLowerCase();

const normalizeContactId = (value) => {
    const id = normalizeIdText(value).replace(/^@/, '');
    if (!id) return '';
    if (id.endsWith('@s.whatsapp.net')) return `${id.slice(0, -'@s.whatsapp.net'.length)}@c.us`;
    return id;
};

const isContactParticipantId = (value) => {
    const id = normalizeContactId(value);
    const [local, server] = id.split('@');
    return /^\d+$/.test(local || '') && (server === 'c.us' || server === 'lid');
};

const parseSerializedMessageId = (value) => {
    const serialized = asSerializedId(value).trim();
    const raw = serialized.toLowerCase();
    const parts = serialized.split('_');
    if (parts.length < 3) return { raw, fromMe: null, remote: '', messageId: serialized, participant: '' };

    const suffix = parts.slice(3).join('_');
    const participant = isContactParticipantId(suffix) ? suffix : '';

    return {
        raw,
        fromMe: parts[0].toLowerCase() === 'true' ? true : parts[0].toLowerCase() === 'false' ? false : null,
        remote: normalizeContactId(parts[1]),
        messageId: parts[2] || '',
        participant: normalizeContactId(participant),
    };
};

const first = (...values) => values.map(asSerializedId).find(Boolean) || '';

const normalizeWahaMessage = (payload = {}) => {
    const data = payload._data || {};
    const idObj = payload.id || data.id || {};
    const parsedId = parseSerializedMessageId(first(idObj._serialized, idObj, data.id));
    const fromMe = payload.fromMe === true || idObj.fromMe === true || data.fromMe === true || data.id?.fromMe === true || parsedId.fromMe === true;
    const from = normalizeContactId(first(payload.from, data.from));
    const to = normalizeContactId(first(payload.to, data.to));
    const remote = normalizeContactId(first(payload.chatId, idObj.remote, data.id?.remote, data.key?.remoteJid, data.Info?.Chat, parsedId.remote));
    const isGroup = remote.endsWith('@g.us') || to.endsWith('@g.us') || from.endsWith('@g.us');
    const chatId = isGroup ? (remote.endsWith('@g.us') ? remote : first(from, to)) : (fromMe ? first(to, remote, from) : first(remote, from, to));
    const participant = normalizeContactId(first(payload.participant, payload.author, data.author, idObj.participant, data.id?.participant, data.Info?.Sender, parsedId.participant));
    const senderJid = fromMe ? from : (isGroup ? participant || from : from || chatId);

    return {
        id: first(idObj._serialized, idObj, data.id),
        messageId: parsedId.messageId || first(idObj.id, data.id?.id),
        chatId,
        chatType: chatId.endsWith('@g.us') ? 'group' : 'dm',
        senderJid,
        fromMe,
        body: String(payload.body || data.body || data.caption || payload.caption || ''),
        type: String(payload.type || data.type || ''),
        timestamp: payload.timestamp || data.t || null,
        participant,
        mentionedIds: payload.mentionedIds || data.mentionedJidList || [],
        raw: payload,
    };
};

module.exports = {
    asSerializedId,
    normalizeIdText,
    normalizeContactId,
    parseSerializedMessageId,
    normalizeWahaMessage,
};
