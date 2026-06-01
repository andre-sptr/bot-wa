const { getQuotedMessageContext } = require('./messageTriggers');
const COIN_NAMES = new Set([
    'btc', 'bitcoin', 'eth', 'ethereum', 'sol', 'solana', 'bnb', 'binancecoin',
    'xrp', 'ripple', 'ada', 'cardano', 'doge', 'dogecoin', 'matic', 'polygon',
    'dot', 'polkadot', 'avax', 'avalanche', 'emas', 'gold',
]);
const CURRENCY_CODES = new Set([
    'usd', 'sgd', 'myr', 'jpy', 'eur', 'gbp', 'aud', 'cny', 'krw', 'thb',
    'php', 'vnd', 'inr', 'hkd', 'twd', 'nzd', 'chf', 'cad', 'sar', 'aed',
]);
const classifyIntent = (message) => {
    const msg = message.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
    // Crypto price
    const pricePatterns = [
        /(?:harga|price)\s+(?:crypto\s+|koin\s+)?(\w+)/,
        /berapa\s+(?:harga\s+)?(?:crypto\s+|koin\s+)?(\w+)/,
        /(?:cek|check|lihat)\s+(?:harga\s+)?(\w+)/,
    ];
    for (const pattern of pricePatterns) {
        const match = msg.match(pattern);
        if (match && COIN_NAMES.has(match[1])) {
            return { type: 'command', command: `/harga ${match[1]}` };
        }
    }
    // Exchange rate
    const kursPatterns = [
        /(?:kurs|rate|exchange)\s+(\w{3})/,
        /(?:berapa|harga)\s+(?:1\s+)?(\w{3})\s+(?:ke|dalam|to)\s+(?:rupiah|idr)/,
    ];
    for (const pattern of kursPatterns) {
        const match = msg.match(pattern);
        if (match && CURRENCY_CODES.has(match[1])) {
            return { type: 'command', command: `/kurs ${match[1]}` };
        }
    }
    // Brief
    if (/\b(morning\s*brief|brief\s*pagi|rangkuman?\s*pagi|crypto\s*brief)\b/.test(msg)) {
        return { type: 'command', command: '/brief' };
    }
    // Stats
    if (/\b(stats?|statistik)\s*(chat|percakapan)?\b/.test(msg)) {
        return { type: 'command', command: '/stats' };
    }
    // Rangkum
    if (/\b(rangkum|summarize|ringkas)\s*(percakapan|chat)?\b/.test(msg)) {
        return { type: 'command', command: '/rangkum' };
    }
    // Reset
    if (/\b(reset|hapus)\s*(riwayat|history|chat)\b/.test(msg)) {
        return { type: 'command', command: '/reset' };
    }
    return { type: 'chat', command: null };
};
// Local message categorization — no AI call needed
const autoCategorize = (message) => {
    const msg = message.toLowerCase().trim();
    if (/^(hi|halo|hey|yo|hai|p|pagi|siang|sore|malam|selamat|assalam|waalaikum|hallo|hello|morning)\b/.test(msg)) return 'GREETING';
    if (/\b(urgent|darurat|penting\s*banget|segera|emergency|gawat|bahaya|tolong\s*cepat)\b/.test(msg)) return 'URGENT';
    if (/\b(tolong|bantu|buatkan|carikan|bikinin|kasih|kirim|coba|please|minta)\b/.test(msg)) return 'REQUEST';
    if (/\b(menurut|pendapat|pikir|diskusi|bagaimana\s*kalau|gimana\s*kalo|setuju|menurutmu)\b/.test(msg)) return 'DISKUSI';
    if (/\?$/.test(message.trim()) || /\b(apa|siapa|kapan|dimana|di\s*mana|kenapa|mengapa|bagaimana|gimana|berapa|apakah|gmn)\b/.test(msg)) return 'PERTANYAAN';
    return 'INFO';
};
// Context-aware AI response with sender awareness and memory
const compactQuotedText = (text = '', maxLength = 500) => {
    const normalized = String(text).replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}…`;
};
const buildDynamicAwarenessContext = ({ chatType, chatName, senderName, senderJid, chatId, quotedMessage, rosterSummary, proactiveMode } = {}) => {
    const lines = [
        'Konteks percakapan saat ini (LATAR BELAKANG, bukan buat diumumin):',
        '- Pakai ini untuk memahami situasi, tone, dan audiens.',
        '- Jangan sebut DM/grup/nama grup/JID kecuali user nanya langsung.',
    ];
    if (chatType === 'dm') lines.push('- Tipe chat: chat pribadi (DM).');
    else if (chatType === 'group') lines.push('- Tipe chat: grup.');
    if (chatName) lines.push(`- Nama grup: ${chatName}.`);
    if (senderName) lines.push(`- Pengirim: ${senderName}.`);
    if (senderJid) lines.push(`- ID pengirim: ${senderJid}.`);
    if (chatId) lines.push(`- ID chat: ${chatId}.`);
    if (chatType === 'group') {
        lines.push('- Privasi: kalau ada ingatan bertanda [privat], itu dari DM pribadi orangnya. JANGAN diungkit di grup kecuali dia sendiri yang mengangkat duluan.');
    }
    if (rosterSummary) {
        lines.push(`- Anggota grup: ${rosterSummary}.`);
        lines.push('- Kalau perlu nge-tag seseorang, tulis @NamaOrang di pesanmu. Tag HANYA kalau relevan.');
        lines.push('- Kalau diminta tag semua orang, tulis @all di pesanmu.');
    }
    if (quotedMessage?.text) {
        const author = quotedMessage.author ? ` dari ${quotedMessage.author}` : '';
        const owner = quotedMessage.fromBot ? ' (pesan Bubu)' : '';
        lines.push(`- Pesan ini me-reply bubble sebelumnya${author}${owner}: "${compactQuotedText(quotedMessage.text)}".`);
    }
    if (proactiveMode) {
        lines.push('');
        lines.push('PENTING — MODE PROAKTIF:');
        lines.push('- Pesan ini TIDAK ditujukan ke kamu. Kamu nimbrung atas inisiatif sendiri.');
        lines.push('- Jawab HANYA kalau kamu punya value asli untuk ditambahkan (info berguna, jawaban pertanyaan, insight menarik).');
        lines.push('- Kalau ragu, pesan cuma basa-basi, atau kamu ga punya value → jawab HANYA dengan [SKIP].');
        lines.push('- Jangan memaksakan diri untuk berkontribusi. Diem lebih baik daripada nimbrung ga jelas.');
    }
    return lines.join('\n');
};
const firstText = (...values) => values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
const buildRuntimeChatContext = ({ chatId = '', senderJid = '', payload = {} } = {}) => {
    const data = payload._data || {};
    const isGroup = chatId.endsWith('@g.us');
    const quotedMessage = getQuotedMessageContext(payload);
    const context = {
        chatType: isGroup ? 'group' : 'dm',
        chatName: isGroup
            ? firstText(
                data.chatName,
                payload.chatName,
                payload.chat?.name,
                data.chat?.name,
                data._chat?.name
            )
            : '',
        chatId,
        senderJid,
    };
    if (quotedMessage) context.quotedMessage = quotedMessage;
    return context;
};
const contextAwareResponse = async (message, askAI, senderOrOptions, memoryContextArg) => {
    try {
        const options = senderOrOptions && typeof senderOrOptions === 'object'
            ? senderOrOptions
            : { senderName: senderOrOptions, memoryContext: memoryContextArg };
        const { senderName, memoryContext, chatContext } = options;
        const now = new Date();
        const hour = parseInt(now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false }));
        const greeting = hour < 11 ? 'pagi' : hour < 15 ? 'siang' : hour < 18 ? 'sore' : 'malam';
        let contextInfo = `${buildDynamicAwarenessContext({
            ...chatContext,
            senderName: chatContext?.senderName || senderName,
        })}
Konteks operasional:
- Waktu: ${now.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}
- Hari: ${now.toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long' })}
- Sesi: ${greeting}`;
        if (senderName) {
            contextInfo += `\n- Pengirim: ${senderName}`;
        }
        if (memoryContext) {
            contextInfo += `\n\nIngatan percakapan sebelumnya:\n${memoryContext}`;
        }
        return await askAI(
            `Jawab pesan dari ${senderName || 'user'} dengan gaya khas Bubu. Gunakan konteks berikut jika relevan.\n\n${contextInfo}`,
            message
        );
    } catch {
        return null;
    }
};
const summarizeConversation = async (history, askAI) => {
    try {
        if (!history || history.length === 0) return 'Belum ada riwayat percakapan.';
        const conv = history.map(m => {
            const name = m.role === 'user' ? (m.sender || 'User') : 'Bubu';
            return `${name}: ${m.content}`;
        }).join('\n');
        return await askAI(
            'Buatkan rangkuman singkat dari percakapan berikut dalam 3-5 poin utama.\n\nPercakapan:\n' + conv,
            'Rangkum percakapan ini.', false
        );
    } catch {
        return null;
    }
};
module.exports = {
    classifyIntent,
    autoCategorize,
    buildDynamicAwarenessContext,
    buildRuntimeChatContext,
    contextAwareResponse,
    summarizeConversation,
};
