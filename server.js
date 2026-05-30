require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const { getHistory, addMessage, clearHistory, getStats, getSummaries, getRelevantMemory, withChatLock } = require('./chatContext');
const {
    classifyIntent,
    autoCategorize,
    buildRuntimeChatContext,
    contextAwareResponse,
    summarizeConversation,
} = require('./modules/aiAdvanced');
const { getPersonaPrompt, getActivePersonaName } = require('./modules/aiFeatures');
const { loadAndStartReminders, manageRecurringReminder, manageServerMonitor, checkAllServers } = require('./modules/automation');
const {
    createBotTriggerState,
    detectMessageTrigger,
    getPayloadChatId,
    getPayloadSenderId,
    isOutgoingMessage,
    learnBotMentionFromIncoming,
    messageIdCandidates,
    rememberBotMessage,
} = require('./modules/messageTriggers');
const { createDebugStore, previewText, safeError } = require('./modules/webhookDebug');
const { parseBubuReply } = require('./modules/reasoning');
const { buildBubuPersona } = require('./modules/bubuPersona');
const { buildSystemBlocks } = require('./modules/systemBlocks');

const app = express();
app.use(express.json());

// ==========================================
// 1. KONFIGURASI
// ==========================================
const WAHA_URL = process.env.WAHA_URL;
const WAHA_SESSION = process.env.WAHA_SESSION;
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const GROUP_ID = process.env.GROUP_ID;
const BOT_PHONE = process.env.BOT_PHONE?.replace(/\D/g, '') || '';
const BOT_LID = process.env.BOT_LID?.replace(/@lid$/i, '') || '';
const PORT = process.env.PORT || 3000;
const DEBUG_TOKEN = process.env.DEBUG_TOKEN || '';
const WAHA_POLL_INTERVAL_MS = parseInt(process.env.WAHA_POLL_INTERVAL_MS || '5000', 10);
const BUBU_PERSONA = buildBubuPersona({ botPhone: BOT_PHONE });

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const webhookDebug = createDebugStore({ maxEntries: 100 });

// ==========================================
// 2. RATE LIMITER
// ==========================================
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 3000;

const isRateLimited = (userId) => {
    const now = Date.now();
    const last = rateLimitMap.get(userId) || 0;
    if (now - last < RATE_LIMIT_MS) return true;
    rateLimitMap.set(userId, now);
    return false;
};

// ==========================================
// 3. CRYPTO & KURS
// ==========================================
const COIN_ALIAS = {
    btc: 'bitcoin', eth: 'ethereum', sol: 'solana', bnb: 'binancecoin',
    xrp: 'ripple', ada: 'cardano', doge: 'dogecoin', matic: 'matic-network',
    dot: 'polkadot', avax: 'avalanche-2', emas: 'tether-gold', gold: 'tether-gold'
};

const getCrypto = async (coinInput) => {
    try {
        const coinId = COIN_ALIAS[coinInput.toLowerCase()] || coinInput.toLowerCase();
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=idr`,
            { timeout: 8000 }
        );
        let price = res.data?.[coinId]?.idr;
        if (!price) return 'N/A';
        if (coinId === 'tether-gold') price = price / 31.1035;
        return Math.round(price).toLocaleString('id-ID');
    } catch { return 'N/A'; }
};

const getMultipleCrypto = async (coinsArray) => {
    try {
        const ids = coinsArray.join(',');
        const res = await axios.get(
            `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=idr`,
            { timeout: 8000 }
        );
        const prices = {};
        coinsArray.forEach(coin => {
            let price = res.data?.[coin]?.idr;
            if (!price) { prices[coin] = 'N/A'; return; }
            if (coin === 'tether-gold') price = price / 31.1035;
            prices[coin] = Math.round(price).toLocaleString('id-ID');
        });
        return prices;
    } catch (e) {
        console.error('Gagal load multiple crypto:', e.message);
        return {};
    }
};

const getKurs = async (currency = 'USD') => {
    try {
        const code = currency.toUpperCase();
        const res = await axios.get(`https://api.exchangerate-api.com/v4/latest/IDR`, { timeout: 8000 });
        const rate = res.data?.rates?.[code];
        if (!rate) return null;
        return Math.round(1 / rate).toLocaleString('id-ID');
    } catch { return null; }
};

// ==========================================
// 4. AI ENGINE
// ==========================================
const formatForWhatsApp = (text) => {
    if (!text) return text;
    return text.replace(/\*\*(.+?)\*\*/g, '*$1*');
};

const makeAskAI = (chatId, senderName) => async (systemPrompt, userMessage, useContext = true) => {
    try {
        const personaExtra = getPersonaPrompt();
        const staticSystemText = `${BUBU_PERSONA}\n\nGaya bicara: ${personaExtra}`;
        const systemBlocks = buildSystemBlocks(staticSystemText, systemPrompt);

        const messages = [];

        if (useContext && chatId) {
            const history = getHistory(chatId);
            for (const msg of history) {
                const content = msg.role === 'user' && msg.sender
                    ? `[${msg.sender}] ${msg.content}`
                    : msg.content;
                messages.push({ role: msg.role, content });
            }
        }

        const formattedMessage = (useContext && senderName)
            ? `[${senderName}] ${userMessage}`
            : userMessage;
        messages.push({ role: 'user', content: formattedMessage });

        if (messages.length > 0 && messages[0].role !== 'user') messages.shift();

        const mergedMessages = [];
        for (const msg of messages) {
            const last = mergedMessages[mergedMessages.length - 1];
            if (last && last.role === msg.role) {
                last.content += '\n' + msg.content;
            } else {
                mergedMessages.push({ ...msg });
            }
        }

        const response = await anthropic.messages.create({
            model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
            system: systemBlocks,
            messages: mergedMessages,
            max_tokens: 1200,
            temperature: 0.85
        });

        const rawText = response.content
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join('\n');

        const { reasoning, response: parsedResponse } = parseBubuReply(rawText);
        if (reasoning) {
            const preview = reasoning.length > 280 ? reasoning.slice(0, 280) + '…' : reasoning;
            console.log(`[Bubu reasoning][${chatId || 'no-chat'}] ${preview}`);
        }

        const aiReply = formatForWhatsApp(parsedResponse);

        if (useContext && chatId && aiReply) addMessage(chatId, userMessage, aiReply, senderName);
        return aiReply;
    } catch (error) {
        console.error('Error AI:', error?.message || error);
        return null;
    }
};

// ==========================================
// 5. KIRIM WA + track sent message IDs for reply detection
// ==========================================
const botTriggerState = createBotTriggerState({ botPhone: BOT_PHONE, botLid: BOT_LID });

const summarizeBotState = () => ({
    botIdentifiers: [...botTriggerState.botIdentifiers],
    recentBotMessageIdCount: botTriggerState.recentBotMessageIds.size,
    recentBotMessageIdsSample: [...botTriggerState.recentBotMessageIds].slice(-5),
});

const debugId = (value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'object') return value._serialized || value.id || value.ID || null;
    return null;
};

const processedIncomingMessageIds = new Set();
const MAX_PROCESSED_INCOMING_IDS = 500;

const getPayloadMessageIds = (payload = {}) => {
    const rawId = payload.id || payload._data?.id;
    return messageIdCandidates(rawId);
};

const hasProcessedIncoming = (payload = {}) => {
    const ids = getPayloadMessageIds(payload);
    return ids.length > 0 && ids.some(id => processedIncomingMessageIds.has(id));
};

const markProcessedIncoming = (payload = {}) => {
    for (const id of getPayloadMessageIds(payload)) {
        if (processedIncomingMessageIds.has(id)) processedIncomingMessageIds.delete(id);
        processedIncomingMessageIds.add(id);
    }

    while (processedIncomingMessageIds.size > MAX_PROCESSED_INCOMING_IDS) {
        const oldest = processedIncomingMessageIds.values().next().value;
        processedIncomingMessageIds.delete(oldest);
    }
};

const maskPhone = (value) => {
    if (!value) return '';
    if (value.length <= 6) return '***';
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
};

const safeWahaUrl = () => {
    try {
        return WAHA_URL ? new URL(WAHA_URL).origin : null;
    } catch {
        return WAHA_URL || null;
    }
};

const requireDebugAccess = (req, res, next) => {
    if (!DEBUG_TOKEN) return next();
    const token = req.get('X-Debug-Token') || req.query.token;
    if (token === DEBUG_TOKEN) return next();
    return res.status(401).json({ error: 'debug token required' });
};

const debugStatus = () => ({
    status: 'ok',
    uptime: process.uptime(),
    config: {
        port: PORT,
        wahaUrl: safeWahaUrl(),
        wahaSession: WAHA_SESSION || null,
        groupId: GROUP_ID || null,
        botPhone: maskPhone(BOT_PHONE),
        botLid: BOT_LID || null,
        anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
        hasWahaApiKey: Boolean(WAHA_API_KEY),
        hasAnthropicApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
        debugTokenRequired: Boolean(DEBUG_TOKEN),
    },
    state: summarizeBotState(),
    debugEntryCount: webhookDebug.size(),
});

const summarizePayload = (body = {}, payload = {}, chatId = '', senderJid = '') => {
    const data = payload._data || {};
    const replyTo = payload.replyTo || payload.reply_to || null;

    return {
        event: body.event || null,
        fromMe: payload.fromMe === true,
        id: debugId(payload.id || data.id),
        from: debugId(payload.from),
        to: debugId(payload.to),
        chatId,
        senderJid,
        participant: debugId(payload.participant || payload.author || data.author || data.id?.participant),
        notifyName: data.notifyName || payload.notifyName || null,
        bodyPreview: previewText(payload.body || ''),
        hasReplyTo: Boolean(replyTo || payload.hasQuotedMsg || data.quotedStanzaID || data.quotedMsg),
        replyToId: debugId(replyTo?.id || replyTo?._data?.id || data.quotedStanzaID || data.quotedMsg?.id),
        replyToParticipant: debugId(replyTo?.participant || replyTo?.from || replyTo?.author || data.quotedParticipant || data.quotedMsg?.participant),
    };
};

const wahaGet = async (path, params = {}) => {
    const res = await axios.get(`${WAHA_URL}${path}`, {
        params,
        timeout: 10000,
        headers: { 'X-Api-Key': WAHA_API_KEY },
    });
    return res.data;
};

const analyzeWahaMessage = (payload = {}, chat = null) => {
    const chatId = getPayloadChatId(payload) || debugId(chat?.id) || '';
    const senderJid = getPayloadSenderId(payload, chatId);
    const body = payload.body || payload._data?.body || '';
    const trigger = detectMessageTrigger({ body, payload, state: botTriggerState });

    return {
        chatName: chat?.name || null,
        chatId,
        senderJid,
        unreadCount: chat?.unreadCount,
        timestamp: payload.timestamp || payload._data?.t || chat?.timestamp || null,
        trigger,
        payload: summarizePayload({ event: 'waha-chat-snapshot' }, payload, chatId, senderJid),
        state: summarizeBotState(),
    };
};

const sendWA = async (text, chatId = GROUP_ID) => {
    try {
        const res = await axios.post(`${WAHA_URL}/api/sendText`, {
            session: WAHA_SESSION,
            chatId,
            text
        }, {
            headers: { 'X-Api-Key': WAHA_API_KEY, 'Content-Type': 'application/json' }
        });

        const tracked = rememberBotMessage(botTriggerState, res.data);
        webhookDebug.record('send-ok', {
            chatId,
            textPreview: previewText(text),
            responseId: res.data?.id?._serialized || res.data?.id || null,
            trackedMessageIds: tracked.messageIds,
            trackedBotIdentifiers: tracked.botIdentifiers,
            state: summarizeBotState(),
        });
        return { ok: true, data: res.data, tracked };
    } catch (e) {
        const error = safeError(e);
        webhookDebug.record('send-failed', {
            chatId,
            textPreview: previewText(text),
            error,
        });
        console.error('Gagal kirim WA:', e?.response?.data || e.message);
        return { ok: false, error };
    }
};

const parseWaktu = (str) => {
    const match = str.match(/(?:(\d+)h)?(?:(\d+)m)?/i);
    if (!match || (!match[1] && !match[2])) return null;
    return ((parseInt(match[1] || 0) * 60) + parseInt(match[2] || 0)) * 60 * 1000;
};

// ==========================================
// 6. PROCESS COMMAND
// ==========================================
const processCommand = async (msg, chatId, askAI) => {
    if (!msg?.startsWith('/')) return null;

    const [cmd, ...args] = msg.trim().split(' ');
    const param = args.join(' ');
    const command = cmd.toLowerCase();

    switch (command) {
        case '/harga': {
            if (!param) return 'Format: `/harga [koin]`\nContoh: `/harga bitcoin` atau `/harga btc`\n\nKoin populer: btc, eth, sol, bnb, xrp, doge, emas';
            const price = await getCrypto(param);
            return price !== 'N/A'
                ? `*${param.toUpperCase()}*: Rp ${price}`
                : `Koin "${param}" tidak ditemukan. Coba nama lengkap seperti "bitcoin".`;
        }

        case '/tanya': {
            if (!param) return 'Format: `/tanya [pertanyaan]`\nContoh: `/tanya apa itu blockchain?`';
            const ans = await askAI('Bantu jawab pertanyaan ini dengan singkat, jelas, dan gaya khas Bubu.', param);
            return ans || 'Bubu lagi gabisa jawab nih, coba lagi ya!';
        }

        case '/brief': {
            const coins = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'tether-gold'];
            const prices = await getMultipleCrypto(coins);
            return `*Morning Brief*\n\n*Crypto & Emas (IDR):*\n` +
                `- BTC: Rp ${prices['bitcoin'] || 'N/A'}\n` +
                `- ETH: Rp ${prices['ethereum'] || 'N/A'}\n` +
                `- SOL: Rp ${prices['solana'] || 'N/A'}\n` +
                `- BNB: Rp ${prices['binancecoin'] || 'N/A'}\n` +
                `- Emas: Rp ${prices['tether-gold'] || 'N/A'}/troy oz`;
        }

        case '/kurs': {
            const currency = param?.toUpperCase() || 'USD';
            const rate = await getKurs(currency);
            if (!rate) return `Mata uang "${currency}" tidak ditemukan.\nContoh: /kurs USD, /kurs SGD, /kurs JPY`;
            return `*Kurs ${currency}*\n\n1 ${currency} = *Rp ${rate}*\n\n_Sumber: exchangerate-api.com_`;
        }

        case '/reminder': {
            if (!param || args.length < 2) return 'Format: `/reminder [waktu] [pesan]`\nContoh: `/reminder 30m Minum obat`\nWaktu: `5m`, `1h`, `2h30m`';
            const ms = parseWaktu(args[0]);
            if (!ms) return 'Format waktu tidak valid. Gunakan: `5m`, `1h`, `2h30m`';
            const pesanReminder = args.slice(1).join(' ');
            setTimeout(() => sendWA(`*REMINDER!*\n\n${pesanReminder}`, chatId), ms);
            const menit = Math.round(ms / 60000);
            const readableTime = menit >= 60
                ? `${Math.floor(menit / 60)} jam ${menit % 60 > 0 ? (menit % 60) + ' menit' : ''}`.trim()
                : `${menit} menit`;
            return `*Reminder diset!*\n\n"${pesanReminder}"\nDalam ${readableTime}`;
        }

        case '/harian': {
            return manageRecurringReminder(args[0]?.toLowerCase(), args.slice(1).join(' '), sendWA);
        }

        case '/server': {
            return await manageServerMonitor(args[0]?.toLowerCase(), args.slice(1).join(' '), sendWA);
        }

        case '/rangkum': {
            const history = getHistory(chatId);
            if (history.length === 0) return 'Belum ada riwayat percakapan untuk dirangkum.';
            const summary = await summarizeConversation(history, askAI);
            return summary ? `*Rangkuman Percakapan:*\n\n${summary}` : 'Gagal merangkum percakapan.';
        }

        case '/stats': {
            const stats = getStats(chatId);
            return `*Statistik Chat*\n\n` +
                `Pesan tersimpan: ${stats.messageCount}\n` +
                `Ingatan tersimpan: ${stats.memoryCount} session\n` +
                `Aktivitas terakhir: ${stats.lastActivity}\n` +
                `Auto-expire dalam: ${stats.hoursUntilExpire}h\n` +
                `Kapasitas max: ${stats.maxHistory} pesan`;
        }

        case '/reset': {
            clearHistory(chatId);
            return `Riwayat chat Bubu sudah di-reset! Bubu siap ngobrol topik baru`;
        }

        case '/help':
            return `*Daftar Command ${getActivePersonaName()}*\n\n` +
                `*/harga [koin]* — Harga crypto\n` +
                `*/kurs [mata_uang]* — Kurs ke IDR\n` +
                `*/tanya [pertanyaan]* — Tanya Bubu\n` +
                `*/brief* — Morning brief\n` +
                `*/reminder [waktu] [pesan]*\n` +
                `*/harian [jam] [pesan]*\n` +
                `*/harian [hari] [jam] [pesan]*\n` +
                `*/server* — Monitor server\n` +
                `*/rangkum* — Rangkum percakapan\n` +
                `*/stats* — Statistik chat\n` +
                `*/reset* — Reset riwayat chat\n\n` +
                `_Panggil "Bubu", reply pesan Bubu, atau tag @Bubu untuk ngobrol!_`;

        default:
            return null;
    }
};

// ==========================================
// 7. NATURAL LANGUAGE HANDLER
// ==========================================
const CATEGORY_EMOJI = {
    URGENT: '!', REQUEST: '',
    PERTANYAAN: '', DISKUSI: '',
    INFO: '', GREETING: ''
};

const handleNaturalLanguage = async (msg, chatId, senderName, askAI, chatContext) => {
    try {
        const category = autoCategorize(msg);
        const intent = classifyIntent(msg);

        if (intent.type === 'command' && intent.command) {
            const result = await processCommand(intent.command, chatId, askAI);
            if (result) return result;
        }

        const memoryContext = getRelevantMemory(chatId, msg);
        const response = await contextAwareResponse(msg, askAI, { senderName, memoryContext, chatContext });
        if (!response) return null;

        const prefix = category === 'URGENT' ? '! ' : '';
        return `${prefix}${response}`;
    } catch (e) {
        console.error('NL Handler error:', e?.message);
        return null;
    }
};

// ==========================================
// 8. SCHEDULER
// ==========================================
cron.schedule('30 06 * * *', async () => {
    console.log('[CRON] Running Morning Brief...');
    const coins = ['bitcoin', 'ethereum', 'solana', 'binancecoin', 'tether-gold'];
    const prices = await getMultipleCrypto(coins);
    const brief = `*Morning Brief*\n\n*Crypto & Emas (IDR):*\n` +
        `- BTC: Rp ${prices['bitcoin'] || 'N/A'}\n` +
        `- ETH: Rp ${prices['ethereum'] || 'N/A'}\n` +
        `- SOL: Rp ${prices['solana'] || 'N/A'}\n` +
        `- BNB: Rp ${prices['binancecoin'] || 'N/A'}\n` +
        `- Emas: Rp ${prices['tether-gold'] || 'N/A'}\n\nSemangat pagi!`;
    await sendWA(brief);
}, { timezone: 'Asia/Jakarta' });

// ==========================================
// 9. WEBHOOK
// ==========================================

const processIncomingPayload = async ({ body, payload, record, source = 'webhook', force = false }) => {
    const _data = payload._data || {};
    const chatId = getPayloadChatId(payload);
    const isDM = chatId.endsWith('@c.us');
    const isTargetGroup = Boolean(GROUP_ID && chatId === GROUP_ID);
    // Allow: target group OR any private DM. Drop other groups / broadcasts / channels.
    if (!isDM && !isTargetGroup) {
        record(`${source}-chat-filtered`, {
            reason: 'chat is neither target group nor DM',
            expectedGroupId: GROUP_ID,
            actualChatId: chatId,
            payload: summarizePayload(body, payload, chatId),
        });
        return;
    }

    if (isOutgoingMessage(payload)) {
        const tracked = rememberBotMessage(botTriggerState, {
            id: _data.id || payload.id,
            participant: payload.participant || payload.author,
            author: payload.author,
            _data,
            me: body.me,
        });
        markProcessedIncoming(payload);
        record(`${source}-outgoing-ignored`, {
            payload: summarizePayload(body, payload, chatId),
            tracked,
            state: summarizeBotState(),
        });
        return;
    }

    const msgBody = (payload.body || _data.body || '').trim();
    if (!msgBody) {
        record(`${source}-empty-body`, {
            payload: summarizePayload(body, payload, chatId),
        });
        return;
    }

    if (!force && hasProcessedIncoming(payload)) {
        record(`${source}-duplicate`, {
            payload: summarizePayload(body, payload, chatId),
        });
        return;
    }

    // Sender identification (notifyName lives in _data)
    const isGroup = chatId.endsWith('@g.us');
    const senderJid = isGroup ? getPayloadSenderId(payload, chatId) : chatId;
    const senderName = _data.notifyName || payload.notifyName || senderJid.split('@')[0];
    const chatContext = buildRuntimeChatContext({ chatId, senderJid, payload });

    // === Trigger detection ===
    const learnedFromIncoming = learnBotMentionFromIncoming(botTriggerState, payload);
    if (learnedFromIncoming.length > 0) {
        record(`${source}-incoming-bot-lid-learned`, {
            learnedBotIdentifiers: learnedFromIncoming,
            payload: summarizePayload(body, payload, chatId, senderJid),
            state: summarizeBotState(),
        });
    }

    const trigger = detectMessageTrigger({ body: msgBody, payload, state: botTriggerState, isDM });
    if (!trigger) {
        record(`${source}-no-trigger`, {
            payload: summarizePayload(body, payload, chatId, senderJid),
            state: summarizeBotState(),
        });
        return;
    }
    if (isRateLimited(senderJid)) {
        record(`${source}-rate-limited`, {
            trigger,
            senderName,
            payload: summarizePayload(body, payload, chatId, senderJid),
        });
        return;
    }

    markProcessedIncoming(payload);
    record(`${source}-trigger-detected`, {
        trigger,
        senderName,
        payload: summarizePayload(body, payload, chatId, senderJid),
        state: summarizeBotState(),
    });
    console.log(`[Msg] ${senderName} | ${trigger} | "${msgBody.substring(0, 50)}"`);

    // Process with per-chat lock to prevent race conditions
    await withChatLock(chatId, async () => {
        const askAI = makeAskAI(chatId, senderName);

        let reply = null;
        if (trigger === 'cmd') {
            reply = await processCommand(msgBody, chatId, askAI);
        } else {
            reply = await handleNaturalLanguage(msgBody, chatId, senderName, askAI, chatContext);
        }

        if (!reply) {
            record(`${source}-no-reply-generated`, {
                trigger,
                senderName,
                payload: summarizePayload(body, payload, chatId, senderJid),
            });
            return;
        }

        record(`${source}-reply-generated`, {
            trigger,
            senderName,
            chatId,
            replyPreview: previewText(reply),
        });
        const sendResult = await sendWA(reply, chatId);
        record(sendResult.ok ? `${source}-reply-sent` : `${source}-reply-send-failed`, {
            trigger,
            senderName,
            chatId,
            error: sendResult.error || null,
        });
    });
};

app.post('/webhook', async (req, res) => {
    res.sendStatus(200);

    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const record = (stage, details = {}) => webhookDebug.record(stage, { requestId, ...details });

    try {
        const body = req.body;
        if (body?.event !== 'message' && body?.event !== 'message.any') {
            record('ignored-event', { event: body?.event || null });
            return;
        }

        const payload = body?.payload;
        if (!payload) {
            record('missing-payload', { event: body?.event || null });
            return;
        }
        const _data = payload._data || {};
        record('webhook-received', {
            payload: summarizePayload(body, payload),
            state: summarizeBotState(),
        });

        // Track outgoing messages so later replies/mentions can identify Bubu.
        if (payload.fromMe) {
            const tracked = rememberBotMessage(botTriggerState, {
                id: _data.id || payload.id,
                participant: payload.participant || payload.author,
                author: payload.author,
                _data,
                me: body.me,
            });
            const learnedLid = tracked.botIdentifiers.find(id => id.endsWith('@lid'));
            if (learnedLid) console.log(`[Bot] LID tracked: ${learnedLid}`);
            record('outgoing-tracked', {
                payload: summarizePayload(body, payload),
                tracked,
                state: summarizeBotState(),
            });
            return;
        }

        await processIncomingPayload({ body, payload, record, source: 'webhook' });
    } catch (err) {
        record('webhook-error', { error: safeError(err) });
        console.error('[Webhook] Error:', err?.message || err);
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', bot: 'Bubu', uptime: process.uptime() });
});

app.get('/debug/status', requireDebugAccess, (req, res) => {
    res.json(debugStatus());
});

app.get('/debug/events', requireDebugAccess, (req, res) => {
    res.json({
        ...debugStatus(),
        events: webhookDebug.list(),
    });
});

app.get('/debug/last', requireDebugAccess, (req, res) => {
    res.json({
        ...debugStatus(),
        latest: webhookDebug.latest(),
    });
});

app.post('/debug/clear', requireDebugAccess, (req, res) => {
    webhookDebug.clear();
    res.json({ cleared: true, ...debugStatus() });
});

app.get('/debug/waha/chats', requireDebugAccess, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '10', 10) || 10, 50);
        const data = await wahaGet(`/api/${WAHA_SESSION}/chats`, { limit });
        const chats = Array.isArray(data) ? data : [];
        const analyzed = chats.map(chat => analyzeWahaMessage(chat.lastMessage || {}, chat));

        webhookDebug.record('waha-chats-fetched', {
            count: chats.length,
            analyzed: analyzed.map(item => ({
                chatName: item.chatName,
                chatId: item.chatId,
                trigger: item.trigger,
                bodyPreview: item.payload.bodyPreview,
                hasReplyTo: item.payload.hasReplyTo,
            })),
        });

        res.json({
            ...debugStatus(),
            count: chats.length,
            analyzed,
        });
    } catch (error) {
        const safe = safeError(error);
        webhookDebug.record('waha-chats-fetch-failed', { error: safe });
        res.status(502).json({ ...debugStatus(), error: safe });
    }
});

app.get('/debug/waha/session', requireDebugAccess, async (req, res) => {
    try {
        const data = await wahaGet(`/api/sessions/${WAHA_SESSION}`);
        webhookDebug.record('waha-session-fetched', {
            session: data?.name || WAHA_SESSION,
            status: data?.status || data?.state || null,
            webhooks: data?.config?.webhooks || data?.webhooks || null,
        });
        res.json({
            ...debugStatus(),
            session: {
                name: data?.name || WAHA_SESSION,
                status: data?.status || data?.state || null,
                config: data?.config || null,
                webhooks: data?.config?.webhooks || data?.webhooks || null,
            },
        });
    } catch (error) {
        const safe = safeError(error);
        webhookDebug.record('waha-session-fetch-failed', { error: safe });
        res.status(502).json({ ...debugStatus(), error: safe });
    }
});

app.post('/debug/waha/process-latest', requireDebugAccess, async (req, res) => {
    const requestId = `manual-${Date.now().toString(36)}`;
    const record = (stage, details = {}) => webhookDebug.record(stage, { requestId, ...details });

    try {
        const limit = Math.min(parseInt(req.query.limit || '10', 10) || 10, 50);
        const data = await wahaGet(`/api/${WAHA_SESSION}/chats`, { limit });
        const chats = Array.isArray(data) ? data : [];
        const target = chats.find(chat => getPayloadChatId(chat.lastMessage || {}) === GROUP_ID);

        if (!target?.lastMessage) {
            record('manual-process-missing-target', { groupId: GROUP_ID, count: chats.length });
            return res.status(404).json({ ...debugStatus(), error: `No lastMessage found for ${GROUP_ID}` });
        }

        await processIncomingPayload({
            body: { event: 'manual.waha.process-latest' },
            payload: target.lastMessage,
            record,
            source: 'manual',
            force: true,
        });

        res.json({
            ...debugStatus(),
            processed: analyzeWahaMessage(target.lastMessage, target),
            events: webhookDebug.list().filter(entry => entry.requestId === requestId),
        });
    } catch (error) {
        const safe = safeError(error);
        record('manual-process-failed', { error: safe });
        res.status(502).json({ ...debugStatus(), error: safe });
    }
});

// Debug: log raw WAHA payload (hit /webhook/debug to see last payload)
let lastPayload = null;
app.post('/webhook/debug', (req, res) => {
    lastPayload = req.body;
    console.log('[Debug Webhook] Full payload:', JSON.stringify(req.body, null, 2));
    res.sendStatus(200);
});
app.get('/webhook/debug', (req, res) => {
    res.json(lastPayload || { message: 'No payload received yet. Point WAHA webhook to /webhook/debug first.' });
});

let pollBaselineReady = false;
let pollInFlight = false;

const pollWahaChats = async () => {
    if (!WAHA_POLL_INTERVAL_MS || WAHA_POLL_INTERVAL_MS < 1000 || pollInFlight) return;
    pollInFlight = true;
    const requestId = `poll-${Date.now().toString(36)}`;
    const record = (stage, details = {}) => webhookDebug.record(stage, { requestId, ...details });

    try {
        const data = await wahaGet(`/api/${WAHA_SESSION}/chats`, { limit: 20 });
        const chats = Array.isArray(data) ? data : [];
        const targetMessages = chats
            .map(chat => ({ chat, payload: chat.lastMessage }))
            .filter(item => item.payload && getPayloadChatId(item.payload) === GROUP_ID);

        if (!pollBaselineReady) {
            targetMessages.forEach(item => markProcessedIncoming(item.payload));
            pollBaselineReady = true;
            record('poll-baseline-ready', {
                intervalMs: WAHA_POLL_INTERVAL_MS,
                trackedMessages: targetMessages.length,
            });
            return;
        }

        for (const item of targetMessages) {
            await processIncomingPayload({
                body: { event: 'poll.waha.chats' },
                payload: item.payload,
                record,
                source: 'poll',
            });
        }
    } catch (error) {
        record('poll-failed', { error: safeError(error) });
    } finally {
        pollInFlight = false;
    }
};

// ==========================================
// 10. INIT
// ==========================================
loadAndStartReminders(sendWA);

if (WAHA_POLL_INTERVAL_MS && WAHA_POLL_INTERVAL_MS >= 1000) {
    pollWahaChats();
    setInterval(pollWahaChats, WAHA_POLL_INTERVAL_MS);
    console.log(`[Poll] WAHA chat fallback aktif tiap ${WAHA_POLL_INTERVAL_MS}ms`);
}

cron.schedule('*/5 * * * *', async () => {
    await checkAllServers(sendWA);
}, { timezone: 'Asia/Jakarta' });

app.listen(PORT, () => console.log(`Bubu Bot aktif di port ${PORT}`));
