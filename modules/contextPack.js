// Context Pack: single source of truth for compact runtime context.
// The renderer is intentionally terse so Haiku spends attention on the message.

const { getQuotedMessageContext } = require('./messageTriggers');
const { getRelevantMemory } = require('../chatContext');

const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';

const compactText = (value, maxLen = 500) => {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen - 3)}...`;
};

const pushLine = (lines, key, value) => {
    const text = compactText(value, 1000);
    if (!text) return;
    lines.push(`${key}=${text}`);
};

const buildContextPack = ({
    chatId = '',
    senderJid = '',
    canonicalSenderJid = '',
    senderName = '',
    payload = {},
    roster = null,
    messageText = '',
    trigger = '',
    proactiveMode = false,
}) => {
    const isGroup = String(chatId).endsWith('@g.us');
    const _data = payload._data || {};

    const pack = {
        chat: {
            id: chatId,
            type: isGroup ? 'group' : 'dm',
            name: isGroup
                ? firstText(
                    _data.chatName,
                    payload.chatName,
                    payload.chat?.name,
                    _data.chat?.name,
                    _data._chat?.name,
                )
                : '',
        },
        sender: {
            name: senderName,
            jid: senderJid,
            canonicalJid: canonicalSenderJid || senderJid,
        },
        message: {
            text: messageText,
            quoted: getQuotedMessageContext(payload),
        },
        mode: {
            trigger,
            proactive: proactiveMode,
        },
        roster: null,
        memory: null,
        time: {},
    };

    const now = new Date();
    const hour = parseInt(now.toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: 'numeric',
        hour12: false,
    }));

    pack.time = {
        now: now.toISOString(),
        jakarta: now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        dayName: now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long' }),
        hour,
        greeting: hour < 11 ? 'pagi' : hour < 15 ? 'siang' : hour < 18 ? 'sore' : 'malam',
    };

    if (isGroup && roster && Array.isArray(roster.participants)) {
        const participants = roster.participants.slice(0, 20);
        pack.roster = {
            participants,
            participantCount: roster.participants.length,
        };
    }

    const memoryContext = getRelevantMemory(chatId, messageText, senderJid);
    if (memoryContext) {
        pack.memory = {
            relevant: memoryContext,
        };
    }

    return pack;
};

const renderContextPackForPrompt = (pack) => {
    const lines = ['Runtime context, do not announce:'];
    const senderId = pack.sender?.canonicalJid || pack.sender?.jid || '';

    pushLine(lines, 'chat.type', pack.chat?.type);
    pushLine(lines, 'chat.name', pack.chat?.name);
    pushLine(lines, 'chat.id', pack.chat?.id);
    pushLine(lines, 'sender.name', pack.sender?.name);
    pushLine(lines, 'sender.jid', pack.sender?.jid);
    pushLine(lines, 'sender.id', senderId);
    pushLine(lines, 'mode.trigger', pack.mode?.trigger);

    if (pack.chat?.type === 'group') {
        lines.push('privacy=private memories stay private unless the same person brings them up');
    }

    if (pack.roster?.participants) {
        const memberText = pack.roster.participants
            .filter((participant) => participant?.name || participant?.id)
            .map((participant) => {
                const name = compactText(participant.name || 'unknown', 80);
                const id = compactText(participant.id || '', 120);
                return id ? `${name}:${id}` : name;
            })
            .join(', ');

        lines.push(`roster.count=${pack.roster.participantCount}`);
        pushLine(lines, 'roster.members', memberText);
    }

    if (pack.message?.quoted?.text) {
        const quoted = pack.message.quoted;
        pushLine(lines, 'message.replyTo.text', compactText(quoted.text, 500));
        pushLine(lines, 'message.replyTo.author', quoted.author);
        lines.push(`message.replyTo.fromBot=${quoted.fromBot === true ? 'true' : 'false'}`);
    }

    if (pack.mode?.proactive) {
        lines.push('mode.proactive=true');
        lines.push('mode.proactiveRule=reply only if useful; otherwise answer [SKIP]');
    }

    lines.push('capabilities=send_dm, send_group, mention_user, tag_all_literal');
    pushLine(lines, 'time.jakarta', pack.time?.jakarta);
    pushLine(lines, 'time.day', pack.time?.dayName);
    pushLine(lines, 'time.greeting', pack.time?.greeting);
    pushLine(lines, 'memory.relevant', pack.memory?.relevant);

    return lines.join('\n');
};

module.exports = {
    buildContextPack,
    renderContextPackForPrompt,
};
