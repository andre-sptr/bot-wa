require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const { getHistory, addMessage, getRelevantMemory } = require('./chatContext');
const {
    classifyIntent,
    autoCategorize,
    contextAwareResponse,
} = require('./modules/aiAdvanced');
const { getPersonaPrompt } = require('./modules/aiFeatures');
const { loadAndStartReminders, checkAllServers } = require('./modules/automation');
const {
    createBotTriggerState,
    detectMessageTrigger,
    getPayloadChatId,
    getPayloadSenderId,
    messageIdCandidates,
    rememberBotMessage,
} = require('./modules/messageTriggers');
const { createDebugStore, previewText, safeError } = require('./modules/webhookDebug');
const { parseBubuReply } = require('./modules/reasoning');
const { buildBubuPersona } = require('./modules/bubuPersona');
const { buildSystemBlocks } = require('./modules/systemBlocks');
const { createGroupRosterClient } = require('./modules/groupRoster');
const { createLidResolver } = require('./modules/lidResolver');
const { guardMentions } = require('./modules/mentionHelper');
const { createCooldownStore } = require('./modules/cooldownStore');
const { getMultipleCrypto } = require('./modules/crypto');
const { createCommandHandler } = require('./modules/commands');
const { createWebhookProcessor } = require('./modules/webhookProcessor');
const lifecycle = require('./modules/lifecycle');

const app = express();
app.use(express.json());

// Section: KONFIGURASI
const WAHA_URL = process.env.WAHA_URL;
const WAHA_SESSION = process.env.WAHA_SESSION;
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const TARGET_GROUPS = (process.env.GROUP_ID || "").split(",").map(id => id.trim()).filter(Boolean);
const BOT_PHONE = process.env.BOT_PHONE?.replace(/\D/g, '') || '';
const BOT_LID = process.env.BOT_LID?.replace(/@lid$/i, '') || '';
const PORT = process.env.PORT || 3000;
const DEBUG_TOKEN = process.env.DEBUG_TOKEN || '';
// Webhook jadi path utama; polling cuma safety net kalau webhook miss/delay.
// Default 30s = ~2880 hit/hari ke WAHA /chats. Sebelumnya 5s = ~17k/hari (boros).
// Override via env WAHA_POLL_INTERVAL_MS kalau butuh refresh lebih cepat di dev.
const WAHA_POLL_INTERVAL_MS = parseInt(process.env.WAHA_POLL_INTERVAL_MS || '30000', 10);
const BUBU_PERSONA = buildBubuPersona({ botPhone: BOT_PHONE });

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    maxRetries: 3,        // default 2; +1 untuk transient 429/5xx
    timeout: 30_000,      // 30s per request, ditambah retry budget
});

const webhookDebug = createDebugStore({ maxEntries: 100 });

// Section: RATE LIMITER
const rateLimitMap = new Map();
const RATE_LIMIT_MS = 3000;

const MENTION_COOLDOWN_MS = 5_000; // 5s cooldown per group for mentions
const mentionCooldownStore = createCooldownStore({
    storageKey: 'mention_cooldowns',
    ttlMs: MENTION_COOLDOWN_MS,
});

const isRateLimited = (userId) => {
    const now = Date.now();
    const last = rateLimitMap.get(userId) || 0;
    if (now - last < RATE_LIMIT_MS) return true;
    rateLimitMap.set(userId, now);
    return false;
};

// Section: AI ENGINE
const formatForWhatsApp = (text) => {
    if (!text) return text;
    return text.replace(/\*\*(.+?)\*\*/g, '*$1*');
};

const makeAskAI = (chatId, senderName, senderJid = null) => async (systemPrompt, userMessage, useContext = true) => {
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

        if (useContext && chatId && aiReply) addMessage(chatId, userMessage, aiReply, senderName, senderJid);
        return aiReply;
    } catch (error) {
        console.error('Error AI:', error?.message || error);
        // Setelah SDK retry budget habis: jangan bisu — kasih sinyal ramah.
        // null hanya untuk kasus tertentu (mis. summarizeConversation) supaya caller bisa
        // kasih message-nya sendiri; di sini chat normal punya chatId+sender → reply fallback.
        if (!chatId) return null;
        return 'Bubu lagi nge-lag bentar nih, coba lagi ya sebentar.';
    }
};

// Section: KIRIM WA + track sent message IDs for reply detection
const botTriggerState = createBotTriggerState({ botPhone: BOT_PHONE, botLid: BOT_LID });

const groupRosterClient = (WAHA_URL && WAHA_SESSION) ? createGroupRosterClient({
    wahaUrl: WAHA_URL,
    session: WAHA_SESSION,
    apiKey: WAHA_API_KEY || '',
    httpGet: (url, opts) => axios.get(url, opts),
}) : null;

// Resolve @lid (sender grup) → @c.us (nomor kanonik) untuk unified cross-context (Gap #1).
const lidResolver = (WAHA_URL && WAHA_SESSION) ? createLidResolver({
    wahaUrl: WAHA_URL,
    session: WAHA_SESSION,
    apiKey: WAHA_API_KEY || '',
    httpGet: (url, opts) => axios.get(url, opts),
}) : null;

const resolveCanonicalSender = async (senderJid) => {
    if (!lidResolver || !senderJid) return senderJid || null;
    try { return await lidResolver.canonicalId(senderJid); } catch { return senderJid; }
};

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
        targetGroups: TARGET_GROUPS,
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

const sendWA = async (text, chatId = TARGET_GROUPS[0], mentions = []) => {
    try {
        const body = {
            session: WAHA_SESSION,
            chatId,
            text,
        };
        const safeMentions = guardMentions(mentions);
        if (safeMentions.length > 0) body.mentions = safeMentions;

        const res = await axios.post(`${WAHA_URL}/api/sendText`, body, {
            headers: { 'X-Api-Key': WAHA_API_KEY, 'Content-Type': 'application/json' }
        });

        const tracked = rememberBotMessage(botTriggerState, res.data);
        webhookDebug.record('send-ok', {
            chatId,
            textPreview: previewText(text),
            responseId: res.data?.id?._serialized || res.data?.id || null,
            trackedMessageIds: tracked.messageIds,
            trackedBotIdentifiers: tracked.botIdentifiers,
            mentionCount: safeMentions.length,
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

const processCommand = createCommandHandler({ sendWA, groupRosterClient });

// Section: NATURAL LANGUAGE HANDLER
const CATEGORY_EMOJI = {
    URGENT: '!', REQUEST: '',
    PERTANYAAN: '', DISKUSI: '',
    INFO: '', GREETING: ''
};

const handleNaturalLanguage = async (msg, chatId, senderName, askAI, chatContext, senderJid = null) => {
    try {
        const category = autoCategorize(msg);
        const intent = classifyIntent(msg);

        if (intent.type === 'command' && intent.command) {
            const result = await processCommand(intent.command, chatId, askAI);
            if (result) return result;
        }

        const memoryContext = getRelevantMemory(chatId, msg, senderJid);
        const response = await contextAwareResponse(msg, askAI, { senderName, memoryContext, chatContext });
        if (!response) return null;

        const prefix = category === 'URGENT' ? '! ' : '';
        return `${prefix}${response}`;
    } catch (e) {
        console.error('NL Handler error:', e?.message);
        return null;
    }
};

// Section: SCHEDULER
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

// Section: WEBHOOK

const processIncomingPayload = createWebhookProcessor({
    sendWA,
    makeAskAI,
    processCommand,
    handleNaturalLanguage,
    summarizePayload,
    resolveCanonicalSender,
    hasProcessedIncoming,
    markProcessedIncoming,
    isRateLimited,
    summarizeBotState,
    botTriggerState,
    groupRosterClient,
    lidResolver,
    mentionCooldownStore,
    TARGET_GROUPS,
    MENTION_COOLDOWN_MS,
});

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
        const target = chats.find(chat => TARGET_GROUPS.includes(getPayloadChatId(chat.lastMessage || {})));

        if (!target?.lastMessage) {
            record('manual-process-missing-target', { groupId: TARGET_GROUPS, count: chats.length });
            return res.status(404).json({ ...debugStatus(), error: `No lastMessage found for ${TARGET_GROUPS}` });
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
        // Process both: target group AND any DM (private chat)
        // DMs can be @c.us or @lid depending on WAHA version
        const targetMessages = chats
            .map(chat => ({ chat, payload: chat.lastMessage }))
            .filter(item => {
                if (!item.payload) return false;
                const cid = getPayloadChatId(item.payload);
                if (TARGET_GROUPS.includes(cid)) return true; // target group
                // DM: not a group, not broadcast, not newsletter
                if (cid.endsWith('@g.us')) return false;
                if (cid.endsWith('@broadcast')) return false;
                if (cid.endsWith('@newsletter')) return false;
                return cid.length > 0;
            });

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

// Section: INIT
loadAndStartReminders(sendWA);

let pollInterval = null;
if (WAHA_POLL_INTERVAL_MS && WAHA_POLL_INTERVAL_MS >= 1000) {
    pollWahaChats();
    pollInterval = setInterval(pollWahaChats, WAHA_POLL_INTERVAL_MS);
    console.log(`[Poll] WAHA chat fallback aktif tiap ${WAHA_POLL_INTERVAL_MS}ms`);
    lifecycle.register('stop-poll', () => clearInterval(pollInterval));
}

cron.schedule('*/5 * * * *', async () => {
    await checkAllServers(sendWA);
}, { timezone: 'Asia/Jakarta' });

const httpServer = app.listen(PORT, () => console.log(`Bubu Bot aktif di port ${PORT}`));

lifecycle.register('close-http', () => new Promise((resolve) => {
    httpServer.close(() => resolve());
    // Forced timeout: jangan hang lebih dari 5 detik.
    setTimeout(resolve, 5_000).unref();
}));

lifecycle.installSignalHandlers();
