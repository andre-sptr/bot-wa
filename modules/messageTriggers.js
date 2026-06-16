const DEFAULT_MAX_TRACKED_IDS = 200;

const {
    asSerializedId,
    normalizeContactId,
    normalizeIdText,
    normalizeWahaMessage,
    parseSerializedMessageId,
} = require('./wahaIdentity');

const contactVariants = (value) => {
    const normalized = normalizeContactId(value);
    if (!normalized) return [];

    const variants = new Set([normalized]);
    const at = normalized.indexOf('@');
    const local = at >= 0 ? normalized.slice(0, at) : normalized;

    if (local) {
        variants.add(local);
        if (/^\d+$/.test(local)) {
            variants.add(`${local}@c.us`);
            variants.add(`${local}@s.whatsapp.net`);
            variants.add(`${local}@lid`);
        }
    }

    return [...variants];
};

const matchesAnyContact = (value, knownIds) => {
    for (const variant of contactVariants(value)) {
        if (knownIds.has(variant)) return true;
    }
    return false;
};

const addLimited = (set, value, maxSize) => {
    if (!value) return false;
    if (set.has(value)) set.delete(value);
    set.add(value);
    while (set.size > maxSize) {
        const oldest = set.values().next().value;
        set.delete(oldest);
    }
    return true;
};

const createBotTriggerState = ({ botPhone = '', botLid = '', maxTrackedIds = DEFAULT_MAX_TRACKED_IDS } = {}) => {
    const state = {
        botIdentifiers: new Set(),
        recentBotMessageIds: new Set(),
        maxTrackedIds,
    };

    for (const variant of contactVariants(botPhone.replace(/\D/g, ''))) {
        state.botIdentifiers.add(variant);
    }
    for (const variant of contactVariants(botLid.replace(/^@/, ''))) {
        state.botIdentifiers.add(variant);
    }

    return state;
};

const messageIdCandidates = (value) => {
    const id = normalizeIdText(value);
    if (!id) return [];

    const candidates = new Set([id]);
    const parsed = parseSerializedMessageId(value);
    if (parsed.messageId) {
        candidates.add(parsed.messageId);
        candidates.add(normalizeIdText(parsed.messageId));
    }
    return [...candidates];
};

const isOutgoingMessage = (payload = {}) => {
    const data = payload._data || {};
    const parsedId = parseSerializedMessageId(
        asSerializedId(payload.id?._serialized) ||
        asSerializedId(payload.id) ||
        asSerializedId(data.id?._serialized) ||
        asSerializedId(data.id)
    );

    return payload.fromMe === true ||
        payload.id?.fromMe === true ||
        payload._data?.id?.fromMe === true ||
        payload._data?.fromMe === true ||
        parsedId.fromMe === true;
};

const addBotIdentifier = (state, value) => {
    const normalized = normalizeContactId(value);
    if (!normalized || normalized.endsWith('@g.us') || normalized.endsWith('@newsletter')) return [];

    const added = [];
    for (const variant of contactVariants(normalized)) {
        if (!state.botIdentifiers.has(variant)) {
            state.botIdentifiers.add(variant);
            added.push(variant);
        }
    }
    return added;
};

const rememberBotMessage = (state, message) => {
    const added = { messageIds: [], botIdentifiers: [] };
    const idValue = asSerializedId(message?._data?.id) || asSerializedId(message?.id) || asSerializedId(message);

    for (const candidate of messageIdCandidates(idValue)) {
        if (addLimited(state.recentBotMessageIds, candidate, state.maxTrackedIds)) {
            added.messageIds.push(candidate);
        }
    }

    const parsedId = parseSerializedMessageId(idValue);
    if (parsedId.participant && parsedId.participant.includes('@')) {
        added.botIdentifiers.push(...addBotIdentifier(state, parsedId.participant));
    }

    for (const value of [
        message?.me?.id,
        message?.participant,
        message?.author,
        message?._data?.author,
        message?._data?.id?.participant,
        message?._data?.Info?.Sender,
    ]) {
        added.botIdentifiers.push(...addBotIdentifier(state, value));
    }

    return added;
};

const getPayloadChatId = (payload = {}) => {
    return normalizeWahaMessage(payload).chatId;
};

const getPayloadSenderId = (payload = {}, chatId = '') => {
    const normalizedChatId = normalizeIdText(chatId);
    const normalized = normalizeWahaMessage({ ...payload, chatId: payload.chatId || normalizedChatId });

    return normalized.senderJid || normalizedChatId || '';
};

const collectMentionValues = (value, out = []) => {
    if (!value) return out;
    if (typeof value === 'string' || typeof value === 'number') {
        out.push(value);
        return out;
    }
    if (Array.isArray(value)) {
        value.forEach(item => collectMentionValues(item, out));
        return out;
    }
    if (typeof value === 'object') {
        for (const key of ['id', '_serialized', 'jid', 'user']) {
            if (value[key]) collectMentionValues(value[key], out);
        }
    }
    return out;
};

const collectMentionFields = (value, out = []) => {
    if (!value || typeof value !== 'object') return out;

    for (const [key, child] of Object.entries(value)) {
        if (/mention/i.test(key)) {
            collectMentionValues(child, out);
            continue;
        }
        if (child && typeof child === 'object') {
            collectMentionFields(child, out);
        }
    }

    return out;
};

const getMentionContactsInBody = (payload, body) => {
    const text = normalizeIdText(body || payload?.body || payload?._data?.body || '');
    if (!text) return [];

    const contacts = new Map();
    for (const value of collectMentionFields(payload)) {
        const normalized = normalizeContactId(value);
        if (!normalized) continue;

        const local = normalized.split('@')[0];
        if (local && text.includes(`@${local}`)) {
            const existing = contacts.get(local);
            const shouldPrefer = !existing || (!existing.includes('@') && normalized.includes('@'));
            if (shouldPrefer) contacts.set(local, normalized);
        }
    }

    return [...contacts.values()];
};

const payloadTargetsKnownBot = (payload, state) => {
    const data = payload?._data || {};
    return [
        payload?.to,
        data.to,
        data.id?.to,
    ].some(value => matchesAnyContact(value, state.botIdentifiers));
};

const learnBotMentionFromIncoming = (state, payload = {}) => {
    if (!state || payload.fromMe === true) return [];
    if (!payloadTargetsKnownBot(payload, state)) return [];

    const contacts = getMentionContactsInBody(payload, payload.body);
    if (contacts.length !== 1) return [];

    return addBotIdentifier(state, contacts[0]);
};

const bodyMentionsBot = (body, state) => {
    const text = normalizeIdText(body);
    if (!text) return false;

    for (const id of state.botIdentifiers) {
        const local = id.split('@')[0];
        if (local && text.includes(`@${local}`)) return true;
    }
    return false;
};

const payloadMentionsBot = (payload, state) => {
    const mentionValues = collectMentionFields(payload);
    return mentionValues.some(value => matchesAnyContact(value, state.botIdentifiers));
};

const collectReplyIdValues = (payload) => {
    const replyTo = payload?.replyTo || payload?.reply_to || {};
    const data = payload?._data || {};

    return [
        replyTo.id,
        replyTo._data?.id,
        data.quotedStanzaID,
        data.quotedMsg?.id,
        data.quotedMsg?._data?.id,
        payload?.quotedMsg?.id,
        payload?.quotedMsg?._data?.id,
    ];
};

const collectReplyParticipantValues = (payload) => {
    const replyTo = payload?.replyTo || payload?.reply_to || {};
    const data = payload?._data || {};

    return [
        replyTo.participant,
        replyTo.from,
        replyTo.author,
        replyTo._data?.participant,
        replyTo._data?.author,
        replyTo._data?.id?.participant,
        data.quotedParticipant,
        data.quotedMsg?.participant,
        data.quotedMsg?.from,
        data.quotedMsg?.author,
        data.quotedMsg?._data?.author,
        payload?.quotedMsg?.participant,
        payload?.quotedMsg?.from,
        payload?.quotedMsg?.author,
    ];
};

const quotedTextFrom = (message = {}) => {
    return [
        message.body,
        message.text,
        message.caption,
        message._data?.body,
        message._data?.text,
        message._data?.caption,
    ].map(asSerializedId).find(text => text.trim())?.trim() || '';
};

const quotedAuthorFrom = (message = {}) => {
    const rawAuthor = [
        message.participant,
        message.from,
        message.author,
        message._data?.participant,
        message._data?.author,
        message._data?.id?.participant,
    ].map(asSerializedId).map(value => value.trim()).find(Boolean) || '';

    if (!rawAuthor) return '';
    if (/@|^\d+$/.test(rawAuthor)) return normalizeContactId(rawAuthor);
    return rawAuthor;
};

const getQuotedMessageContext = (payload = {}) => {
    const data = payload._data || {};
    const candidates = [
        payload.replyTo,
        payload.reply_to,
        payload.quotedMsg,
        data.quotedMsg,
    ].filter(Boolean);

    for (const quoted of candidates) {
        const text = quotedTextFrom(quoted);
        if (!text) continue;

        return {
            text,
            author: quotedAuthorFrom(quoted),
            fromBot: quoted.fromMe === true || quoted._data?.fromMe === true,
        };
    }

    return null;
};

const isReplyToBot = (payload, state) => {
    const replyTo = payload?.replyTo || payload?.reply_to;
    const data = payload?._data || {};
    const hasReply = Boolean(
        replyTo ||
        payload?.hasQuotedMsg === true ||
        data.quotedStanzaID ||
        data.quotedMsg ||
        payload?.quotedMsg
    );

    if (!hasReply) return false;
    if (replyTo?.fromMe === true || replyTo?._data?.fromMe === true) return true;
    if (data.quotedMsg?.fromMe === true || payload?.quotedMsg?.fromMe === true) return true;

    for (const idValue of collectReplyIdValues(payload)) {
        for (const candidate of messageIdCandidates(idValue)) {
            if (state.recentBotMessageIds.has(candidate)) return true;
        }
    }

    return collectReplyParticipantValues(payload)
        .some(value => matchesAnyContact(value, state.botIdentifiers));
};

const isMentionToBot = (payload, body, state) => {
    return bodyMentionsBot(body, state) || payloadMentionsBot(payload, state);
};

const detectMessageTrigger = ({ body = '', payload = {}, state, isDM = false }) => {
    if (isOutgoingMessage(payload)) return null;

    const text = (body || payload?.body || '').trim();
    if (!text) return null;
    if (text.startsWith('/')) return 'cmd';
    if (text.toLowerCase().includes('bubu')) return 'name';
    if (isReplyToBot(payload, state)) return 'reply';
    if (isMentionToBot(payload, text, state)) return 'mention';
    // In a 1-on-1 chat (DM), every incoming message is implicitly addressed to the bot.
    if (isDM) return 'dm';
    return null;
};

module.exports = {
    createBotTriggerState,
    detectMessageTrigger,
    getPayloadChatId,
    getPayloadSenderId,
    getQuotedMessageContext,
    isOutgoingMessage,
    learnBotMentionFromIncoming,
    rememberBotMessage,
    messageIdCandidates,
};
