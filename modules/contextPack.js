// Context Pack — single source of truth for building and rendering runtime context.
// Consolidates scattered context assembly from webhookProcessor, aiAdvanced, chatContext, and server.

const { getQuotedMessageContext } = require('./messageTriggers');
const { getRelevantMemory } = require('../chatContext');

const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';

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

    // Time block
    const now = new Date();
    const hour = parseInt(now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
    pack.time = {
        now: now.toISOString(),
        jakarta: now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }),
        dayName: now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long' }),
        hour,
        greeting: hour < 11 ? 'pagi' : hour < 15 ? 'siang' : hour < 18 ? 'sore' : 'malam',
    };

    // Roster block
    if (isGroup && roster && Array.isArray(roster.participants)) {
        const names = roster.participants
            .filter((p) => p.name)
            .map((p) => `${p.name} (${p.id})`)
            .slice(0, 20);
        pack.roster = {
            summary: names.length > 0
                ? `${roster.participants.length} anggota (${names.join(', ')})`
                : `${roster.participants.length} anggota`,
            participants: roster.participants.slice(0, 20),
            participantCount: roster.participants.length,
        };
    }

    // Memory block
    const memoryContext = getRelevantMemory(chatId, messageText, senderJid);
    if (memoryContext) {
        pack.memory = {
            relevant: memoryContext,
        };
    }

    return pack;
};

const renderContextPackForPrompt = (pack) => {
    const lines = [];

    // Awareness context
    lines.push('Konteks percakapan saat ini (LATAR BELAKANG, bukan buat diumamin):');
    lines.push('- Pakai ini untuk memahami situasi, tone, dan audiens.');
    lines.push('- Jangan sebut DM/grup/nama grup/JID kecuali user nanya langsung.');

    if (pack.chat.type === 'dm') lines.push('- Tipe chat: chat pribadi (DM).');
    else if (pack.chat.type === 'group') lines.push('- Tipe chat: grup.');
    if (pack.chat.name) lines.push(`- Nama grup: ${pack.chat.name}.`);
    if (pack.sender.name) lines.push(`- Pengirim: ${pack.sender.name}.`);
    if (pack.sender.jid) lines.push(`- ID pengirim: ${pack.sender.jid}.`);
    if (pack.sender.canonicalJid) lines.push(`- Nomor DM pengirim saat ini: ${pack.sender.canonicalJid}.`);
    if (pack.chat.id) lines.push(`- ID chat: ${pack.chat.id}.`);
    if (pack.sender.canonicalJid) {
        lines.push(`- Kalau user minta DM dirinya sendiri / gue / aku / saya / pengirim ini, gunakan <dm target="${pack.sender.canonicalJid}">isi pesan</dm>.`);
    }

    if (pack.chat.type === 'group') {
        lines.push('- Privasi: kalau ada ingatan bertanda [privat], itu dari DM pribadi orangnya. JANGAN diungkit di grup kecuali dia sendiri yang mengangkat duluan.');
    }

    if (pack.roster?.summary) {
        lines.push(`- Anggota grup: ${pack.roster.summary}.`);
        lines.push('- Kalau perlu nge-tag seseorang, tulis @NamaOrang di pesanmu. Tag HANYA kalau relevan.');
        lines.push('- Kalau diminta tag semua orang, tulis @all di pesanmu.');
    }

    if (pack.message?.quoted?.text) {
        const quoted = pack.message.quoted;
        // Map JID to sender name if possible, or use raw JID
        const author = quoted.author || '';
        const owner = quoted.fromBot ? ' (pesan Bubu)' : '';
        const maxLen = 500;
        const normalized = String(quoted.text).replace(/\s+/g, ' ').trim();
        const text = normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1)}…` : normalized;
        const fromClause = author ? ` dari ${author}` : '';
        lines.push(`- Pesan ini me-reply bubble sebelumnya${fromClause}${owner}: "${text}".`);
    }

    if (pack.mode?.proactive) {
        lines.push('');
        lines.push('PENTING — MODE PROAKTIF:');
        lines.push('- Pesan ini TIDAK ditujukan ke kamu. Kamu nimbrung atas inisiatif sendiri.');
        lines.push('- Jawab HANYA kalau kamu punya value asli untuk ditambahkan (info berguna, jawaban pertanyaan, insight menarik).');
        lines.push('- Kalau ragu, pesan cuma basa-basi, atau kamu ga punya value → jawab HANYA dengan [SKIP].');
        lines.push('- Jangan memaksakan diri untuk berkontribusi. Diem lebih baik daripada nimbrung ga jelas.');
    }

    // Operational context
    lines.push('');
    lines.push('Konteks operasional:');
    lines.push(`- Waktu: ${pack.time.jakarta}`);
    lines.push(`- Hari: ${pack.time.dayName}`);
    lines.push(`- Sesi: ${pack.time.greeting}`);
    if (pack.sender.name) {
        lines.push(`- Pengirim: ${pack.sender.name}`);
    }

    if (pack.memory?.relevant) {
        lines.push('');
        lines.push('Ingatan percakapan sebelumnya:');
        lines.push(pack.memory.relevant);
    }

    return lines.join('\n');
};

module.exports = {
    buildContextPack,
    renderContextPackForPrompt,
};
